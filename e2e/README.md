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
  ring (ties, opponents, undo, restored links, phone width)

Each walkthrough ends with an `... OK, zero page errors` line. Some write drill progress to the browser's
localStorage; every run starts from a fresh browser context.
