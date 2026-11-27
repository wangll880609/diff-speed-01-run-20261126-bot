// diff-speed: a fast drop-in for makefun-diff 1.0.0 (MIT), written from the
// rule in the kit's RULES.txt and the reference's header comment. It returns
// exactly the reference's answer for every input: the same common
// prefix/suffix trim, the same Myers greedy search (deletion wins a tie,
// never past either text's end, no edge-diagonal pruning, every equal run
// followed as far as it goes), and the same patch format (3 context lines,
// runs at most 6 kept lines apart share a hunk, `%` after a line with no
// trailing newline).
//
// Speed comes from three changes, none of which changes an answer:
//  1. Lines are interned to integer ids once (one Map, shared by both
//     texts), so the search compares integers instead of re-scanning
//     strings on every snake step.
//  2. The search keeps its diagonals in flat Int32Arrays, one per edit
//     distance, instead of one heap object per diagonal per distance with
//     a linked list of components. The whole trace is kept so backtracking
//     replays the exact path the forward search chose.
//  3. Prefix/suffix trimming and the middle slice work on index ranges,
//     never on copied arrays.
//
// No dependencies, no network, no WebAssembly, deterministic: two runs
// write byte-identical output.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/**
 * A text's lines (each with its "\n", the last one without when the text
 * does not end in one) and their interned ids, in order. `intern` is shared
 * by both texts so equal lines get equal ids across them.
 */
function tokenize(text, intern) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const hasLast = parts[last] !== '';
  const count = last + (hasLast ? 1 : 0);
  const lines = new Array(count);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    lines[i] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[i] = id;
  }
  if (hasLast) {
    const line = parts[last];
    lines[last] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[last] = id;
  }
  return { lines, ids };
}

/**
 * The runs of the edit script of A into B: [{ kind, count }], in order.
 * A and B are Int32Arrays of interned line ids. This is the reference's
 * search, with the same tie-breaks: at each (d, k) the deletion candidate
 * (one old line past V[d-1][k-1]) wins over the insertion candidate (V[d-1][k+1])
 * whenever it reaches at least as far into the old text, and a candidate
 * that would move past the end of its text is not a candidate at all.
 *
 * The trace is one flat Int32Array: distance d starts at off(d) = d*d + 2*d
 * and holds 2d+3 entries, index k+d+1. Each entry stores x+1 (the old lines
 * consumed after the snake), 0 where the diagonal holds no path, so a fresh
 * zero-filled buffer needs no per-distance fill.
 */
function editRuns(A, B) {
  const N = A.length;
  const M = B.length;
  const off = (d) => d * d + 2 * d;
  // Room for D = 4096 (about 16.8M entries); doubled if a longer search needs it.
  let cap = off(4097);
  let T = new Int32Array(cap);
  const ensure = (need) => {
    if (need <= cap) return;
    if (need > off(8192)) throw new Error(`makefun-diff: search exceeded D=8192 (need ${need} trace entries)`);
    let ncap = cap;
    while (ncap < need) ncap *= 2;
    const nT = new Int32Array(ncap);
    nT.set(T);
    T = nT;
    cap = ncap;
  };
  // d = 0: diagonal 0, index 1.
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[x] === B[y]) {
    x++;
    y++;
  }
  T[1] = x + 1;
  if (x >= N && y >= M) return { runs: x > 0 ? [{ kind: KEEP, count: x }] : [], trace: T, D: 0 };

  let D = -1;
  let kEnd = 0;
  for (let d = 1; d <= N + M; d++) {
    ensure(off(d + 1));
    const pBase = d * d + d - 1; // off(d-1) + (d-1) + 1, index of diagonal k' is pBase + k'
    const cBase = d * d + 3 * d + 1; // off(d) + d + 1, index of diagonal k is cBase + k
    let done = false;
    // k runs -d, -d+2, ..., d; the three indices all rise by 2 per step.
    let iDel = pBase - d - 1;
    let iIns = pBase - d + 1;
    let iCur = cBase - d;
    for (let k = -d; k <= d; k += 2, iDel += 2, iIns += 2, iCur += 2) {
      const ad = T[iDel] - 1; // x of the deletion candidate's path, -1 when none
      const ai = T[iIns] - 1; // x of the insertion candidate's path, -1 when none
      const canDel = ad >= 0 && ad < N;
      const canIns = ai >= 0 && ai - 1 - k < M;
      if (!canDel && !canIns) continue;
      // Deletion wins the tie: its x is ad + 1, the insertion's ai.
      let xx;
      if (canDel && (!canIns || ad >= ai - 1)) xx = ad + 1;
      else xx = ai;
      let yy = xx - k;
      while (xx < N && yy < M && A[xx] === B[yy]) {
        xx++;
        yy++;
      }
      T[iCur] = xx + 1;
      if (xx >= N && yy >= M) {
        D = d;
        kEnd = k;
        done = true;
        break;
      }
    }
    if (done) break;
  }
  if (D === -1) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack: the forward choice at (d, k) is a deterministic function of
  // V[d-1], so replaying it from the trace gives the exact path taken.
  const steps = new Array(D + 1);
  let k = kEnd;
  for (let d = D; d >= 1; d--) {
    const cBase = d * d + 3 * d + 1;
    const pBase = d * d + d - 1;
    const xx = T[cBase + k] - 1;
    const ad = T[pBase + k - 1] - 1;
    const ai = T[pBase + k + 1] - 1;
    const canDel = ad >= 0 && ad < N;
    const canIns = ai >= 0 && ai - 1 - k < M;
    const del = canDel && (!canIns || ad >= ai - 1);
    const prevK = del ? k - 1 : k + 1;
    const prevX = T[pBase + prevK] - 1;
    const x0 = del ? prevX + 1 : prevX;
    steps[d] = { edit: del ? DELETE : INSERT, keep: xx - x0 };
    k = prevK;
  }
  steps[0] = { edit: null, keep: T[1] - 1 };

  // Forward runs, merging consecutive edits of one kind across an empty keep.
  const runs = [];
  const push = (kind, count) => {
    if (count <= 0) return;
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun.kind === kind) lastRun.count += count;
    else runs.push({ kind, count });
  };
  push(KEEP, steps[0].keep);
  for (let d = 1; d <= D; d++) {
    push(steps[d].edit, 1);
    push(KEEP, steps[d].keep);
  }
  return { runs, trace: T, D };
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** makefun-diff 1.0.0's answer for one case's input, computed faster. */
function diffPatch(oldText, newText) {
  const intern = new Map();
  const a = tokenize(oldText, intern);
  const b = tokenize(newText, intern);
  const n = a.lines.length;
  const m = b.lines.length;
  const A = a.ids;
  const B = b.ids;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(A.subarray(prefix, n - suffix), B.subarray(prefix, m - suffix)).runs);
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, a.lines[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, a.lines[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, b.lines[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, a.lines[at]));
  }
  return out.join('');
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  return diffPatch(input.old, input.new);
}
