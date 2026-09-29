# Contributing

Thanks for helping. Catan Lens aims to stay small, explainable and honest, so a few ground rules:

1. **Every scoring change needs a source.** Add or update the row in `docs/RESEARCH.md`: the rule in plain English,
   where it comes from, and the exact coefficient. The ordering principles should come from strong players; the
   weights are ours and are labelled that way.
2. **Every change needs a test.** `npm test` for logic, `npm run e2e` for anything in the page. A test should fail
   before your change and pass after it.
3. **Keep the explanations true.** The panel only prints sentences built from the score's parts. Do not add text
   that is not computed from the board in front of the user.
4. **Keep it dependency-free.** The app is plain modules served as static files. Development tools (Playwright) are
   fine as devDependencies.
5. **Measure claims.** If a change is meant to make the advice better, run `npm run report` and, ideally, the
   Catanatron benchmark in `bench/catanatron`, and put the before/after numbers in the pull request.

## Setup

```sh
npm install
npx playwright install chromium
npm start        # in one terminal
npm test && npm run e2e
```

Set `CATAN_URL` to run the browser tests against another deployment.

## Licensing

Contributions to the app are MIT-licensed. Code in `bench/catanatron/` is GPL-3.0-or-later because it imports
Catanatron. Do not add official Catan artwork, logos or fonts.
