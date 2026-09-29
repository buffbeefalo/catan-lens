# Architecture

Catan Lens is a static web app: HTML, CSS and plain JavaScript modules, no build step and no runtime
dependencies. The scoring code is pure (no DOM), so the same files run in the browser, under `node --test`,
and inside the benchmark tools.

```
public/
  index.html        page shell: header, mode buttons, table settings, the board <svg>, the side panel
  app.js            UI: state, URL (share links), drawing the board and marks, the panel, interaction
  geometry.js       pointy-top hex grid: hex centres, corners (vertices), sides (edges), coastline,
                    and the distance rule (legalVertices)
  board.js          board generation (official variable setup, seeded), Your-board encoding in links,
                    official-box checks
  score.js          the heuristic: scoreVertex (rules R1-R12), rankSpots, grade, compare,
                    simulateDraft (snake draft projection), suggestRoad (R13)
  drill.js          the 16-level ladder: stages, seat resolution, seed search, pass/fail
  style.css         all styling (system fonts only)
  how-it-works.html the explainer page with the videos
  media/            video posters, captions (WebVTT), transcripts, results.json
                    (the MP4s are attached to GitHub Releases, not stored in git)
test/               unit tests (node --test)
e2e/                browser tests (Playwright); run-all.cjs starts the local server
bench/
  production-report.mjs   deterministic opening report (MIT)
  lens-bridge.mjs         JSON-lines bridge so another engine can ask Catan Lens for picks
  catanatron/             full-game benchmark in Catanatron (GPL-3.0-or-later)
video/              how the demo videos are made: scenes.mjs -> narrate.py -> cards.cjs + record.cjs
                    -> render.py -> assemble.py -> qa.py (see video/README.md)
docs/               HOW-IT-WORKS.md, RESEARCH.md (sources and weights), this file;
                    media/ holds the README images, drawn from the videos' own frames
serve.js            zero-dependency local server (npm start)
```

## Data flow

1. `board.js` builds a board from a seed (or from the Your-board link): 19 or 30 hexes, each with a resource and
   number token, plus harbours keyed by coastal edge id. `geometry.js` supplies the graph (54 or 80 corners).
2. `score.js` scores every legal corner. A score is the sum of named parts; each part carries the sentence the
   panel shows, so the UI never invents text. `rankSpots` sorts them; ties share rank 1.
3. `app.js` keeps one `state` object, mirrors it into the URL on every change (so any view can be shared), and
   re-renders the panel and the board marks. Hints (ring, scores, projections, road) are drawn only when the
   current mode allows them (`reveal()`), so blind practice and unanswered drills leak nothing.

## Where to change things

- **A scoring rule**: `score.js`, with a source and the coefficient in `docs/RESEARCH.md`, a unit test in
  `test/score.test.js`, and the production-dominance test still green (the top corner stays within 4 pips of the
  board's best). Re-run `npm run report` and, if you can, the Catanatron benchmark.
- **The board generator**: `board.js` (the drill's seed search depends on it; run `npm test`).
- **A drill level**: the `STAGES` table in `drill.js`.
- **The UI**: `app.js` and `style.css`; run `npm run e2e`.
- **The videos**: edit narration and actions in `video/scenes.mjs`, then run the pipeline in `video/README.md`.
