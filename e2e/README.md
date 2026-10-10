# Browser tests

Headless-Chromium tests (Playwright) against a running copy of the app. `npm run e2e` starts the local server,
runs every walkthrough from a temporary directory (their screenshots never land in the repo), then the interaction
suite. Set `CATAN_URL` to test another deployment instead; set `CHROMIUM_PATH` to use a specific Chromium build.

- `audit.cjs`: reload keeps placement order, hostile links, balanced switch, seed field, tooltips, drill exit
- `drill.cjs`: level ladder: clear / miss / scramble / track / progress / locked links
- `verdict.cjs`: pick grading, verdict cards, the blind preview with Show best off, the suggested starting road
- `draft.cjs`: projected placements, with full snake-draft badge order, spacing and rows
- `focus.cjs`: the keyboard focus ring on corners (a scaled-outline regression)
- `custom.cjs`: Your board: paint, numbers, ports, box check, link round-trip, blank board, hostile links
- `fold.cjs`: layout at phone, foldable, tablet and desktop widths: no sideways scroll; setup and paint tools
  above the board in single column
- `usability.cjs` (`node --test`): confirmation visibility after taps and keys at seven widths, cancellation, taps
  on number tokens, blind-drill hint secrecy, keyboard draft choices, projection visibility, and the best-corner
  ring (ties, opponents, undo, restored links, phone width); keyboard board entry, incomplete-board gating,
  compact phone entry, explicit harbour assumptions, and board recovery across layout changes, refresh
  and browser Back/Forward. Offset taps and mouse clicks cover nearest-corner selection at phone and
  desktop widths, blocked corners, opponent marks and clicks beyond the corner reach.
  Storage checks deny reads and writes, retry failed saves and resets, validate malformed progress,
  and exercise real storage events between two tabs sharing one browser context.
  Opening checks compare preview and committed income, starting cards and build shortfalls, cover
  harbour exclusions and incomplete input, retain the C&K model boundary, and verify result focus
  and phone visibility without leaking hints into unanswered drills.
  Help navigation checks an edited board, harbour choice and Undo order across a help-page reload,
  plus unreadable queries and the fixed same-app return destination.
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

Each walkthrough ends with an `... OK, zero page errors` line. Some write drill progress to the browser's
localStorage; every run starts from a fresh browser context.
