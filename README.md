# diff-speed-01-run-20261126-bot

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/wangll880609/diff-speed-01-run-20261126-bot/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/wangll880609/diff-speed-01-run-20261126-bot/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

Fast drop-in for makefun-diff 1.0.0: `solve.js` answers exactly as the
reference on every case (same common prefix/suffix trim, same Myers greedy
search with deletion winning ties, same patch format with 3 context lines,
`%` after a line with no trailing newline), and runs about 2x faster than
the reference on the practice set. Speed comes from interned line ids
(integer compares in the search instead of re-scanning strings) and a flat
typed-array Myers trace (one Int32Array for all edit distances, x+1 encoding
so no per-distance fill) instead of one heap object per diagonal per
distance. No dependencies, no network, no WebAssembly, deterministic: two
runs write byte-identical output.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

`main.ts` (Node 22, type-stripped) reads every case from `/input/cases.json`,
answers each with `run` from `solve.js`, and writes `/output/answers.json`.

## License

MIT — see `LICENSE`.
