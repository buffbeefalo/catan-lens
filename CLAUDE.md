# Catan Lens: notes for coding agents

Catan Lens is a static, browser-only app (plain ES modules in `public/`, no build, zero runtime dependencies) that
ranks Catan opening settlement corners with rules sourced from strong players (`docs/RESEARCH.md`). Two ranking
policies: classic (`public/score.js`, the default, the one the published benchmark measured) and the experimental
look-ahead (`public/lookahead.js`, policy `draft-aware-2026-10-12`).

## Commands
- `npm test`: unit tests (`node --test test/*.test.js`).
- `npm run e2e`: Playwright walkthroughs and the usability suite (starts `serve.js` unless `CATAN_URL` is set;
  `CATAN_BROWSER=firefox|webkit` picks another engine).
- `npm run report`: deterministic opening report. `node bench/draft-diagnostics.mjs`: greedy-ranking diagnostics.
- `python3 bench/catanatron/verify_*.py` and `python3 bench/catanatron/exact_tests.py --check`: recompute every
  published benchmark figure from the archived raw games.

## Ground rules
- Work on a branch. A push to `main` deploys GitHub Pages.
- Small commits; `npm test` passes before every commit and `npm run e2e` at the end of each piece of work.
- Every scoring change gets a source and a coefficient row in `docs/RESEARCH.md` and a test that fails before the
  change and passes after it. Ordering principles are the experts'; numbers are the author's and say so.
- Explanations are built only from computed values; never add text the board does not support.
- Never edit `bench/catanatron/evidence/` or existing keys of `public/media/results.json`; add new files and keys.
- Never choose or tune a weight, threshold or design on benchmark win rates. Diagnostics (score or rank changes,
  timing, projection accuracy) are fine.
- Keep the classic policy reproducible; old share links keep their meaning.
- No backend, accounts, telemetry, paid APIs or runtime AI calls.
- User-facing text: no em or en dashes (use a period, comma, colon or parentheses; write ranges as "3 to 4"),
  percentage points to one decimal, each caveat once, short sentences.
