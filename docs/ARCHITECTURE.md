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
   Useful direct access keeps priority. Otherwise, R7 checks every legal settlement destination two
   graph edges away and the harbours incident to it, including approaches from inland. It credits
   only the best new harbour type; reaching the coast by road alone does not grant a trade rate.
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
   `popstate` resets board state and rebuilds from that entry's URL inside the existing document. It
   restores the matching Drill return snapshot without fetching the page or discarding pending progress
   saves. The restored panel heading receives focus. A normal refresh can still rebuild from the URL
   and browser history metadata, but needs the app's files to remain available.
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
   coordinate-free button clicks still activate the named corner. With Ports selected,
   `nearestCoastalEdge` measures finite coastal segments within 22 CSS pixels and 0.65 board units;
   it excludes inland edges and tile centers. Equal-distance coastal ties use the smaller edge id.
   Touch selection retains pointer-release coordinates because WebKit can move a generated click
   toward another interactive target. New/cancelled pointers and history restoration clear that value.
   Keyboard/coordinate-free coastal activation edits its named edge; resource tools keep direct hex handlers.
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
   Preview confirmation and desktop result focus always request native nearest scrolling, so the
   browser accounts for a magnified or panned visual viewport rather than the full layout height.
10. The app's help link uses the current serialized board query; the explainer's return link copies its
    `location.search` onto a fixed relative destination. They preserve shareable state, including unreadable queries, without a
    second storage record or a user-controlled return destination. The links work under both the local
    dashboard prefix and GitHub Pages, and the help page can be refreshed before returning.
11. Entering Drill stores the existing free-play state in versioned `history.state.catanFreePlay`.
    The snapshot and destination query are written together before changing modes. Reload reads that
    snapshot; exiting restores it and removes only that field, retaining older
    recovery metadata. `drill=1&setup=1` shares the table-selection screen, while an active exercise
    uses `drill=1&level=N`. The return snapshot stays out of the URL and belongs to the current history
    entry, so a fresh tab's drill link contains no earlier exploration board.

The pure helpers also handle incomplete or stale input defensively: `boardFacts` gives zero-production
boards neutral finite scarcity factors, while the UI still withholds advice until land is complete.
`grade` looks up a selected ID in the supplied ranking and uses that entry's score, not a possibly stale
copy. An absent choice is unavailable, retains the out-of-range rank sentinel, and cannot pass `judge`,
including when the ranking is empty or has fewer entries than the stage target. Valid grades and
complete-board scores are unchanged by these guards.

`grade.pct` is null for a negative pick score or a nonpositive best score. Rank and the hundredth-point
gap remain available; previews and committed verdicts share `gradePosition`, which substitutes that
gap for the percentage. `judge` omits the percentage and percentage-based close-score note in this
case, without changing its rank-based pass rule. Ordinary nonnegative scores beneath a positive best
retain the existing percentage and grade boundaries. Negative-score choices outside the top N remain
Weak; exact ties still share rank 1, including ties at zero or below.

Score rounding snaps only values within eight scaled machine epsilons of a half-cent boundary before
applying `Math.round`. Summing the same three weighted hexes in a different order can otherwise
straddle that boundary, so a rotated or reflected board can acquire a different score or a false tie.
The weights and tie direction are unchanged. Fixed reflection regressions cover both an exact 8.775
production term and a close second-pick ranking whose reflected version previously gained rank 1.

Starting-road explanations use the same full opening projection as the target filter. They identify
opponent conflicts as projected setup choices, and flag a target also assigned to the player's
unplaced second settlement. This adds no score term or direction preference. `roadLine` shares the
existing `reveal()` guard with road drawing, so a first-pick verdict cannot expose future road targets
during blind second-pick practice. Committed-pick grading remains visible.
Both the expansion factor and road hint check destinations exactly two edges away. A missing destination
can mean a corner is blocked by the settlement distance rule, not occupied. Their messages state that
limit; neither infers that longer routes are impossible.

`setupStage` reports `fitsDifficulty` from its actual top-two margin and the stage's inclusive band.
It subtracts integer hundredths, matching the score precision so decimal noise cannot exclude a boundary.
The bounded seed search and the UI use that same result. The notice therefore survives explicit seed
links, seedless-link search exhaustion and refresh; it does not depend on a transient fallback flag.
It reveals no corner or score, changes no pass rule, and does not expand the 120-seed search budget.

An already-loaded app supports entry, scoring, Drill and history recovery without further network
requests. It has no service worker or offline installation cache: first loads, refreshes, the separate
help page and videos can still need a connection. History navigation clears per-board editing and
answer state, while keeping pending local progress actions available for Retry saving.

The HTML contains a startup message before loading any application module. A small inline handler
preserves the query in the help link and shows a retry message when the module download or initial
evaluation fails. It clears a partly rendered board and keeps app controls inert until initialization
finishes. Retry uses native reload, retaining the history entry's Drill return snapshot. The handler
does not suppress errors or replace a working board after startup. Without JavaScript, a written
explanation links to the guide in a separate tab; this is recovery guidance, not offline caching.
The help header preserves its return query immediately, without awaiting a module. Its transcript,
video-fallback and benchmark handlers initialize separately from the theme module, so a delayed or
failed theme download cannot strand the return link or leave that content uninitialized. The help
theme control stays inert until its handler is installed.
Video/source error events reveal the matching transcript. The initial retrospective media check waits
until parsing completes, since `NETWORK_NO_SOURCE` can precede source selection in a healthy video.
`loadeddata` clears an obsolete failure notice without collapsing a transcript the user may be reading.

Keyboard or assistive activation of Your board focuses its first tool; activating a tool focuses the
first editable hex or coast edge. These transitions use the button click's zero `detail`; pointer
activation keeps the existing focus behavior. Escape returns from the SVG editor to its selected tool,
while the number picker's Escape first returns to its hex. Native Tab order remains available, with
no global letter shortcuts or focus trap.
Intentional keyboard editor transitions and number selection explicitly scroll their focused target into
view after rebuilding. This matters
on the single-column layout when expanded guidance separates the palette from the board: WebKit's
focus alone can leave the token above the viewport. Changing the missing-token count can also move the
palette after selection. Number selection reveals the whole picker so touch users can see the other
choices. Nearest scrolling leaves an already visible target in place, including on the picker-to-hex
Escape path. Ordinary repaint focus restoration still uses `preventScroll`.
Number selection on blank or desert tiles focuses and reveals the explanatory paragraph instead of a
picker. The same Escape path returns to that hex, and the board data is unchanged.
The Players and Your seat groups likewise restore their focused value when their buttons are rebuilt,
preserving native Tab order without moving focus from another control.
Segmented buttons draw their focus outline inside the button in its text colour, so the group's clipped
rounded border does not hide it and the selected state retains contrast.

URL serialization skips `replaceState` when the current query already matches. Choosing an editing
tool, opening a number picker or repainting an identical value should not consume the browser's history
update allowance. Changed board data still updates the link synchronously. A refused history write
(`SecurityError` or `DataCloneError`) shows a warning without interrupting rendering. Further ordinary
edits do not repeatedly retry the refused write; the explicit Retry action attempts an update once.
Copy and help use the current board query even when the address bar is stale. A replacement requires
the current URL and its recovery checkpoint to be saved first; a refused checkpoint or Drill transition
leaves the existing board and mode intact. Unexpected programming errors still propagate.
Rapid full-board entry previously exhausted WebKit's limit and interrupted rendering. Browsers may throw for overly frequent calls, as documented for
[`History.replaceState`](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState).

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
