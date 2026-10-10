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
                    simulateDraft (snake draft projection), suggestRoad (R13), openingFacts
  drill.js          the 16-level ladder: stages, seat resolution, seed search, pass/fail,
                    saved-progress validation and pending-action replay
  style.css         all styling (system fonts only); every color is a token with a light and a dark value
  theme.js          light/dark switch: follows the device until the viewer picks, remembers the pick
  how-it-works.html the explainer page with the videos
  media/            video posters, captions (WebVTT), transcripts, results.json
                    (the MP4s are attached to GitHub Releases, not stored in git)
test/               unit tests (node --test)
e2e/                browser tests (Playwright); run-all.cjs starts the local server
bench/
  production-report.mjs   deterministic opening report (MIT)
  lens-bridge.mjs         JSON-lines bridge so another engine can ask Catan Lens for picks
  catanatron/             full-game benchmark in Catanatron (GPL-3.0-or-later)
    evidence/            frozen fresh-seed game records, summaries and dependency versions
    verify_holdout.py    standard-library checks of raw games, clustered intervals and public figures
video/              how the demo videos are made: scenes.mjs -> narrate.py -> cards.cjs + record.cjs
                    -> render.py -> assemble.py -> qa.py (see video/README.md)
docs/               HOW-IT-WORKS.md, RESEARCH.md (sources and weights), this file;
                    media/ holds the README images, drawn from the videos' own frames
serve.js            zero-dependency local server (npm start)
```

## Data flow

The local server opens each file once, reports its length and streams it with backpressure. GET supports
single byte ranges, open-ended ranges and suffix ranges; HEAD returns full-file metadata without a body.
Unsatisfiable ranges return 416 and the file size. Unknown units, multipart and conditional ranges receive
the whole file. Stream completion or cancellation closes the opened file. The existing public-tree boundary
and explicit research-document route apply before opening anything. See
[HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests) and
[RFC 9110, section 14](https://www.rfc-editor.org/rfc/rfc9110.html#section-14).

1. `board.js` builds a board from a seed (or from the Your-board link): 19 or 30 hexes, each with a resource and
   number token, plus harbours keyed by coastal edge id. `geometry.js` supplies the graph (54 or 80 corners).
2. `score.js` scores every legal corner. A score is the sum of named parts; each part carries the sentence the
   panel shows, so the UI never invents text. `rankSpots` sorts them; ties share rank 1.
   R7 derives owned harbour types from `mine` and excludes them from direct and reachable bonuses,
   without altering `board.harbors`. A redundant direct port gets a non-scoring explanation and does
   not prevent a useful different reachable port from being considered.
3. `app.js` keeps one `state` object, mirrors it into the URL on every change (so any view can be shared), and
   re-renders the panel and the board marks. `landReadiness` and `harborStatus` in `board.js` gate ranking and
   draft computation; incomplete land or an unresolved harbour choice also hides placed verdicts and
   combined-opening totals without deleting placements.
   Hints (ring, scores, projections, road) are drawn only when the
   current mode allows them (`reveal()`), so blind practice and unanswered drills leak nothing.
4. Replacing a custom board, changing its layout, or changing an Explore board's seed/balance setting
   checkpoints the existing URL with `pushState`. New board does the same outside Drill.
   Clearing placements creates a `pieces` recovery marker; clearing nothing or reentering the current
   seed creates no checkpoint. The previous URL contains both ownership and placement order.
   Ordinary edits still use `replaceState`, preserving the recovery marker. Restore uses browser Back;
   a `popstate` reload rebuilds the board from that history entry's URL, so recovery also survives refresh.
   Tiles and coastal edge ids are never carried between the 19- and 30-hex graphs. Same-shape player-count
   changes retain the board and placement order.
5. `decodeBoard` returns `null` for unreadable tile or harbour data. The UI retains the original query in
   an error state, suppresses advice and table editing, and offers explicit restart actions. A board that
   decodes at the other geometry gets recovery choices for that geometry's player counts. The decoder
   allows unfinished boards, but rejects numbers on non-producing tiles and duplicate harbour edges.
6. Custom-board harbour mode is `check` by default: a valid standard inventory is included automatically.
   `ports=entered` confirms a valid custom inventory; a port edit clears that confirmation. `ports=ignore`
   keeps the physical board intact but creates an `analysisBoard` with no harbours. Rankings, verdicts,
   projections and road hints all use that same analysis board. Replacing a board or changing geometry
   resets the choice; ordinary edits, same-shape table changes, share links and drill snapshots retain it.
7. Pointer placement converts the click into board coordinates and uses `nearestVertex` across all corners,
   then checks legality. Its reach is bounded in both screen pixels and board units, so overlapping hit
   areas cannot select a farther corner or redirect an occupied corner to a legal one. Keyboard and
   coordinate-free button clicks still activate the named corner; editor tools keep their own handlers.
8. Drill progress validates known table keys and unique integer levels from 1 through `MAX_LEVEL`.
   Unsaved clear/reset actions stay in memory. Each save reads the latest local record and replays only
   these actions, preserving other tables; failed reads or writes show a retry warning. Storage events,
   including `clear()` with a null key, refresh saved flags while retaining pending local actions.
   Unreadable JSON is reported and left untouched until a saving action. No remote storage is used.
9. `openingFacts` computes unweighted resource income, all dice-total payouts, second-placement starting
   cards, owned-harbour bank rates and base-game build-cost shortfalls for two legal settlements. It
   rejects incomplete land and invalid harbour geometry. Both the second-pick preview and the completed
   summary use this helper with `analysisBoard`, so an excluded harbour never improves the displayed
   rates. Shared hexes pay once per settlement; income probability counts each dice total once. These
   facts do not change scores or rankings. The UI hides previews before blind/drill answers and labels
   C&K as a two-settlement comparison without base-game income or build projections. Confirmation moves
   focus to the result (or a saving warning), and the single-column layout scrolls the result into view.
10. The app's help link and the explainer's return link copy `location.search` onto fixed relative
    destinations. They preserve the current shareable state, including unreadable queries, without a
    second storage record or a user-controlled return destination. The links work under both the local
    dashboard prefix and GitHub Pages, and the help page can be refreshed before returning.
11. Entering Drill stores the existing free-play state in versioned `history.state.catanFreePlay`.
    Reload reads that snapshot; exiting restores it and removes only that field, retaining older
    recovery metadata. `drill=1&setup=1` shares the table-selection screen, while an active exercise
    uses `drill=1&level=N`. The return snapshot stays out of the URL and belongs to the current history
    entry, so a fresh tab's drill link contains no earlier exploration board.

## Where to change things

- **A scoring rule**: `score.js`, with a source and the coefficient in `docs/RESEARCH.md`, a unit test in
  `test/score.test.js`, and the sampled production-dominance test still green (its default seat-1 cases stay within 4 pips of the
  board's best). Re-run `npm run report` and, if you can, the Catanatron benchmark.
- **The board generator**: `board.js` (the drill's seed search depends on it; run `npm test`).
- **Opening income or build facts**: `openingFacts` in `score.js`, with rulebook fixtures and independent
  dice enumeration in `test/opening.test.js`; the presentation is shared in `app.js`.
- **Benchmark presentation**: `public/media/results.json` retains the original table and a separate
  `holdout` result. The help page displays both with intervals and explains download failures.
  `python3 bench/catanatron/verify_holdout.py` checks the frozen raw data and public holdout figures;
  CI runs it without installing the simulation engine. Do not retune on a dataset labelled holdout.
- **A drill level**: the `STAGES` table in `drill.js`.
- **The UI**: `app.js` and `style.css`; run `npm run e2e`. A new color goes in as a token in both themes (the
  `:root` block and the two dark blocks); `test/theme.test.js` rejects literal colors and checks contrast.
  Forced-colour overrides use the device's `Highlight`, `HighlightText` and `Canvas` system colours for
  selected controls and board focus. Selected buttons opt out of automatic text backplates only after
  receiving those system colours, so a backplate cannot cover their labels. The current Drill level gets an outline because forced-colour mode
  suppresses box shadows; the rest of the page keeps the browser's adaptations. See the
  [browser behaviour reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors).
- **The videos**: edit narration and actions in `video/scenes.mjs`, then run the pipeline in `video/README.md`.
