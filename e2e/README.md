# Browser tests

Headless-Chromium tests (Playwright) against a running copy of the app. `npm run e2e` starts the local server,
runs every walkthrough from a temporary directory (their screenshots never land in the repo), then the interaction
and starting-road suites. Set `CATAN_URL` to test another deployment instead; set `CHROMIUM_PATH` to use a specific Chromium build.

- `audit.cjs`: reload keeps placement order, hostile links, balanced switch, seed field, tooltips, drill exit
- `drill.cjs`: level ladder: clear / miss / scramble / track / progress / locked links
- `verdict.cjs`: pick grading, verdict cards, the blind preview with Show best off, the suggested starting road
- `draft.cjs`: projected placements, with full snake-draft badge order, spacing and rows
- `focus.cjs`: the keyboard focus ring on corners (a scaled-outline regression)
- `custom.cjs`: Your board: paint, numbers, ports, box check, link round-trip, blank board, hostile links
- `fold.cjs`: layout at phone, foldable, tablet and desktop widths: no sideways scroll; setup and paint tools
  above the board in single column
- `pwa.cjs`: the installable app: manifest and icons, the offline copy taking control, and a board link and the
  help page opening with the network cut (automated browsers skip the offline copy unless a test turns it on)
- `usability.cjs` (`node --test`): confirmation visibility after taps and keys at seven widths, cancellation, taps
  on number tokens, blind-drill hint secrecy, keyboard draft choices, projection visibility, and the best-corner
  ring (ties, opponents, undo, restored links, phone width); keyboard board entry, incomplete-board gating,
  compact phone entry, explicit harbour assumptions, and board recovery across layout changes, refresh
  and browser Back/Forward. Offset taps and mouse clicks cover nearest-corner selection at phone and
  desktop widths, blocked corners, opponent marks and clicks beyond the corner reach.
  Coastal checks tap eight pixels to either side of an edge and at its center, verify one harbour
  change per tap, exclude tile centers, and retain direct keyboard cycling. Geometry checks cover
  coastal-only segment distance, endpoints, stable ties and both full board layouts.
  Storage checks deny reads and writes, retry failed saves and resets, validate malformed progress,
  and exercise real storage events between two tabs sharing one browser context.
  Opening checks compare preview and committed income, starting cards and build shortfalls, cover
  harbour exclusions and incomplete input, retain the C&K model boundary, and verify result focus
  and phone visibility without leaking hints into unanswered drills.
  Help navigation checks an edited board, harbour choice and Undo order across a help-page reload,
  plus unreadable queries and the fixed same-app return destination. Same-tab help retains the private
  Drill return board in setup and active exercises, including after help refreshes, and preserves
  the older previous-board recovery entry. Direct help links and new tabs carry no private checkpoint.
  Evidence-page checks keep original and fresh benchmark intervals distinct, fit both tables on a
  narrow phone and show a useful message when the results download fails.
  Drill-return checks retain generated/custom boards, table settings, placement tools and Undo order
  across setup/exercise reloads, preserve older recovery checkpoints and keep fresh-tab links separate.
  Set `CATAN_BROWSER=firefox` or `CATAN_BROWSER=webkit` to run this suite in another engine.
  Recovery checks use in-page reload and history navigation to exercise the browser's native behavior.
  Generated-board checks cover New board, seed/balance changes and clearing pieces through refresh,
  Back/Forward and restored Undo order. Empty clears and unchanged seeds retain useful checkpoints;
  a new preview during Drill setup still preserves the original free-play return.
  High-contrast checks cover visible selected controls in light/dark palettes and a coastal keyboard
  focus ring against the page. These are browser emulations, not an assistive-technology certification.
  Owned-harbour checks explain duplicate access without improving trade rates, survive reload and
  keep that explanation hidden before a blind-practice commitment.
  Evidence-page checks separate both harbour-policy comparisons from the earlier benchmark, retain
  exact win counts and uncertainty, and fit the tables at phone width. Failed data loads give a
  useful explanation and leave the methods link available.
  Media fallback checks simulate network errors, unsuccessful HTTP responses and empty transcripts,
  then retry successfully with keyboard focus retained. Video errors open the corresponding transcript.
  A tiny generated WAV exercises real media source selection and failed/recovered downloads in the
  video elements without requiring release MP4 assets or optional codecs. Healthy media keeps its
  warning hidden; recovery clears a warning while preserving an already-open transcript.
  Startup checks fail the app or a dependency download, preserve the board link through help, then
  reload successfully. They also retain the Drill return board and cover the JavaScript-off guide.
  Short-screen editing checks expand guidance, open the number picker, change a token and return by
  keyboard, verifying visible focus on both board sizes in phone and landscape layouts.
  Help checks hold or fail the theme download while preserving valid/unreadable return links and
  loading transcripts and benchmark figures independently.
  Blind-practice checks retain committed-pick grades while hiding future road targets in earlier
  verdicts as well as on the map, then restore both through Show best.
  A custom C&K board with a negative-scoring choice checks point-gap feedback in the preview,
  committed verdict and reload, while blind practice still hides the uncommitted comparison.
  Chromium page-scale emulation checks confirmation and result focus at 2×/3× magnification in phone
  and desktop layouts. It checks the visual viewport's vertical bounds; a wide control can still
  require horizontal panning. Other engines skip this CDP-only check, not the ordinary focus tests.

- `starting-roads.cjs` (`node --test`): the starting road you place. Mouse, tap and keyboard placement after Keep,
  moves, the same-side no-op, Undo (including an opponent mark that shares the road's number) and reload; roads
  stay optional and never add settlements, reorder them or change the projected draft. A road is graded on its
  settlement's own turn: on the demo board, after keeping corners 43 and 3, side 56 must read Weak and side 57
  Great although the live board says the reverse, and a later opponent mark or move changes nothing. The drawn
  suggestion for a kept settlement is the side that grades Great, before and after a reload; it stays where
  the preview drew it through Keep, a later mark and Undo; a link without a placement order lists opponents
  first, and its roads are advised and graded from that order through a reload and the re-shared link; and
  Drill still draws from the board as it is. Only a Fair or Weak road is shown the better side, dashed, and
  only with hints on; a road tied for best gets neither a dashed "alternative" nor the card's sentence about
  the other side, and a corner with no two-road target gets no grade. Links from before roads load unchanged; roads before their settlement, off the
  board, away from your settlements or not along a side, repeats, malformed tokens and unknown prefixes are
  dropped, and the latest valid road wins. Blind practice shows only a
  neutral note until both settlements are kept, then a neutrally coloured bare grade; the cards, slot labels,
  descriptions and titles carry no destination, resource, count or projection wording, before and after the
  second settlement, after Undo, after reload and after hints are turned off again. Your board takes roads the
  same way; Drill offers none.

Starting-road acceptance runs offline through `node scripts/verify-starting-roads.mjs`, which needs the installed
`playwright` package and its Chromium (or `CHROMIUM_PATH`) and downloads nothing:
`--unit` runs the unit suite with `test/starting-roads.test.mjs` (including the comparison with the frozen copy
of the previous scorer in `test/fixtures/`); `--browser` starts the local server on a free port and runs every
browser suite; `--mutations` copies the app to a temporary directory, applies 32 targeted mutations one at a
time and requires an assertion in the named regressions to fail for each, rejecting a mutation that survives,
cannot be applied, or fails only through a syntax, module or server error. Each mode fails if a required test
is missing or skipped.

Each walkthrough ends with an `... OK, zero page errors` line. Some write drill progress to the browser's
localStorage; every run starts from a fresh browser context.
