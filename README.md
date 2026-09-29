# Catan Lens

**Where should I put my first two settlements?** Catan Lens looks at every legal corner on a Catan board,
scores it with rules that strong players agree on, and explains the best spot in plain sentences.

**[Open the app](https://buffbeefalo.github.io/catan-lens/)** · **[How it works, with videos](https://buffbeefalo.github.io/catan-lens/how-it-works.html)**

[![Catan Lens in one minute](public/media/overview.jpg)](https://buffbeefalo.github.io/catan-lens/how-it-works.html)

- **Explore** random boards that follow the official setup (3–4 players, or the 5–6 player board). A gold ring marks
  the best open corner; click any corner for a grade and exactly what the best one has that yours lacks.
- **Mark opponents** as they place; the ranking only counts what is still open. **Projected placements** plays out
  the snake draft for every seat, and the suggested starting road avoids corners others are likely to take first.
- **Drill** sixteen levels, easy to hard, on the table you choose. Hints stay hidden until you commit.
- **Your board**: paint the real board on your table; every ranking then applies to it, and the link carries it.
- Runs entirely in your browser: no account, no tracking, no server. Zero runtime dependencies.

Unofficial fan tool, not affiliated with or endorsed by Catan GmbH or Catan Studio. CATAN is a trademark of Catan GmbH.

## How it works

The score for a corner starts with **production** (the dots on the surrounding number tokens: the ways, out of 36,
that two dice roll each number), weighted by how valuable and how scarce each resource is on this board. Small
bonuses go to wood+brick and wheat+ore pairs, a harbour you can feed, and room to grow; repeating a number costs a
little; a second settlement gets credit for covering what the first lacks. Every rule traces to a published source
(King of Catan's expert group, Colonist.io champion interviews, a 400-game statistical study, the standard Cities &
Knights guide, an IEEE paper on Catan agents).

- [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md): the full explanation in plain English
- [docs/RESEARCH.md](docs/RESEARCH.md): every source, every weight, and what was deliberately left out
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code fits together

## Does following it win?

Advice is not proof, so this repository tests it. [`bench/catanatron`](bench/catanatron) plays complete four-player
games in [Catanatron](https://github.com/bcollazo/catanatron), an open-source Catan engine with strong bots. Every
seat is Catanatron's value-function bot; one seat's opening settlements come from a different strategy, then it plays
on exactly like the others. Every strategy sees the same boards and seat orders, and the whole benchmark is repeated
under 20 different bot tie-breaking orders, with intervals computed across those runs (see
[HOW-IT-WORKS](docs/HOW-IT-WORKS.md#5-does-following-it-actually-win-games) for why). A fair seat wins 25%.

| Opening chosen by | Win rate (95% interval) | Games |
|---|---|---|
| Catan Lens settlements and road | 25.2% ± 1.2 | 8,000 |
| Catan Lens settlements, bot's roads | 24.9% ± 1.2 | 8,000 |
| The bot's own opening | 25.8% ± 1.3 | 8,000 |
| Most pips | 16.9% ± 0.9 | 8,000 |
| Random corner | 1.8% ± 0.3 | 8,000 |

These are bot games: they show the advice is sound, not how much it will raise your own win rate. A deterministic
report of what each strategy's opening looks like (`npm run report`) shows why: taking the most pips wins raw
production, as it must by construction, but the openings Catan Lens picks cover more resources, spread across more
numbers, and hold far more of the wheat/ore pair that builds cities.

## Run it

Node 22 or newer. No install is needed to run the app:

```sh
npm start          # http://127.0.0.1:8080/
npm test           # unit tests (scoring, geometry, board generation, drill)
npm install        # once, for the browser tests
npx playwright install chromium
npm run e2e        # browser walkthroughs and interaction tests against the local server
npm run report     # the deterministic opening report
```

Any static file host works: the app is plain HTML, CSS and JavaScript modules in [`public/`](public).

## Build on it

Ideas and fixes are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Good places to start: a denial term (valuing the
corners your pick takes away from others), Seafarers boards, real Cities & Knights rules instead of re-weighting,
translations, or new drill levels. Keep every scoring change tied to a source in RESEARCH.md and to a test.

## License

[MIT](LICENSE), except [`bench/catanatron/`](bench/catanatron), which imports the GPL-licensed Catanatron and is
therefore GPL-3.0-or-later. The demo videos are narrated with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M)
(Apache-2.0).
