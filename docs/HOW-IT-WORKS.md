# How Catan Lens works

Catan Lens answers one question: **where should I put my first two settlements?** It looks at every
legal corner on the board, scores each one with a small set of rules that strong players agree on, and
explains the result in plain sentences. No machine learning, no server, no randomness in the scoring:
the same board always gets the same answer, and every sentence in the "Why this corner?" panel is built
from the numbers that produced the score.

## 1. The board

The app draws the standard 19-hex board (or the 30-hex 5–6 player board), following the official
"variable setup": shuffle the land tiles, lay the number tokens in the official spiral order, deal the
harbours around the coast. With **Balanced setup** on, it keeps red numbers (6 and 8) from touching, as the
rulebook asks. Every board comes from a seed, so a link always reopens the exact same board.

You can also enter the real board in front of you with **Your board**: paint the resources, set the
number tokens, tap the coast to place harbours. Everything else in the app then works on your board.

## 2. The score for one corner

A settlement touches up to three hexes. The score starts with **production** and adds a few small
bonuses and penalties. Production dominates on purpose: across 400 generated boards the top-ranked corner
is always within 4 pips of the board's best-producing corner (this is a test in the repository).

| Rule | What it means at the table |
|---|---|
| Production | Add up the dots (pips) on the surrounding number tokens: a 6 or 8 has 5, a 2 or 12 has 1. The pips are the number of ways, out of 36, that two dice roll that number. |
| Resource value | Wheat and ore build cities and development cards, so they count a little more; sheep a little less. Later seats lean toward wood and brick (a road-building plan). |
| Scarcity | A resource that is rare on *this* board is worth more: it trades at a premium and is hard to get elsewhere. |
| Pairs | Wood with brick (roads) or wheat with ore (cities) from the same corner earns a small bonus. |
| Repeated numbers | Two hexes with the same number means feast-or-famine rolls; a small penalty. |
| Harbours | A 3:1 harbour helps anyone; a 2:1 harbour only helps if you produce plenty of that resource. |
| Room to grow | A strong open corner two roads away is worth something; a dead end is not. |
| Second settlement | Your second pick gets credit for covering resources your first one lacks, especially wheat and ore. |

Each rule traces to a published source (King of Catan's expert group, Colonist.io champion interviews,
a 400-game statistical check, the standard Cities & Knights strategy guide, an IEEE paper on Catan
agents). The full source table, and what was deliberately left out, is in [RESEARCH.md](RESEARCH.md).
The *ordering principles* are the experts'; the exact weights are this project's, tuned so production
stays dominant.

## 3. From one corner to the whole table

- **Ranking.** Every legal corner (the distance rule: no settlement next to another) is scored and
  sorted. The best one gets a gold ring on the map and a "Best settlement" card.
- **Your pick.** Click any corner to preview it: the app grades it (Great / Good / Fair / Weak), shows
  its rank and its score as a percentage of the best, and lists what the best corner has that yours lacks.
- **Opponents.** Switch to "Mark opponent" and click where others placed; the ranking only counts what is
  still open.
- **Projected placements.** Placement is a snake draft (seats 1 to N, then N back to 1). The app plays
  that draft out with the same rules for every seat, so you can see what is likely to be gone before your
  turn comes back.
- **Starting road.** For each settlement the app suggests which way to point the free road: toward the
  best open corner two roads away, preferring a direction with more than one option.

## 4. Drill mode

Sixteen levels, easy to hard, on a table you choose first (3–6 players, base game or Cities & Knights
weighting). Hints stay hidden until you commit. Early levels accept any of the top three corners on boards
with an obvious winner; later levels demand the exact best corner on near-ties, from any seat, for the
first or the second settlement. Miss, and you get a new board at the same level.

## 5. Does following it actually win games?

The rules come from expert advice, but advice is not proof, so the repository tests it three ways.

**Full games.** [`bench/catanatron`](../bench/catanatron) plays complete four-player games in
[Catanatron](https://github.com/bcollazo/catanatron), an open-source Catan engine with strong bots. All four seats
are Catanatron's value-function bot; one seat has its opening chosen by a different strategy, then plays the rest of
the game exactly like the others. A fair seat wins 25%.

| Opening chosen by | Win rate (95% interval) | Games |
|---|---|---|
| Catan Lens settlements and road | 25.2% ± 1.2 | 8,000 |
| Catan Lens settlements, bot's roads | 24.9% ± 1.2 | 8,000 |
| The bot's own opening | 25.8% ± 1.3 | 8,000 |
| Most pips | 16.9% ± 0.9 | 8,000 |
| Random corner | 1.8% ± 0.3 | 8,000 |

One trap worth knowing if you run it yourself: the bots break ties between equally good moves in Python's hash
order, which is fixed for a whole run and differs between runs. A single run therefore plays with one arbitrary bot
"personality", and how well a bot exploits an opening it did not choose varies with that personality much more than
game-to-game luck suggests (an early single-run test swung from 28% to 22% between runs). The table above repeats the
benchmark under 20 different hash seeds and computes the interval across runs, not across games.

**Starting roads.** The opening phase itself is deterministic, so roads can be compared on identical situations.
Over 400 openings, the first road the app suggested used to end in a dead end once setup was over 52% of the time,
because it aimed at the best corner open *now* and other players took it first. It now skips corners the projected
draft hands to other seats: 22% dead ends, against 42% for the bot's own road choice. Win rates did not change
measurably (the bot plays on in its own way after the opening), but a road that leads somewhere is what the advice
is for.

**What the openings look like.** `npm run report` compares the two settlements each strategy ends up with, from
identical situations on 500 boards and every seat, without playing the game:

| Policy | Cards per roll | Resources covered (of 5) | All five covered | Different numbers | Wheat/ore pair (pips of the weaker) | Pips: wood / brick / wheat / sheep / ore |
|---|---|---|---|---|---|---|
| lens | 0.57 | 4.27 | 36% | 5.34 | 2.56 | 4.6 / 3.6 / 4.8 / 3.9 / 3.7 |
| pips | 0.61 | 3.62 | 7% | 5.03 | 1.40 | 4.7 / 3.4 / 4.4 / 6.2 / 3.2 |
| random | 0.30 | 2.73 | 1% | 3.30 | 0.56 | 2.4 / 1.8 / 2.4 / 2.6 / 1.7 |

Taking the most pips wins raw production, as it must by construction. The openings Catan Lens picks cover more
resources, spread across more numbers, and hold far more of the wheat/ore pair that builds cities, which is why
they win more games than "most pips" does.

What this says, and what it does not:

- Openings chosen by Catan Lens win about as often as the strong bot's own, computer-searched openings, and far
  more often than the popular "take the corner with the most dots" rule.
- These are bot games. Bots trade and plan differently from people, so the numbers show the advice is sound, not
  how much it will raise your personal win rate.
- The simulation covers the four-player base game only.

## 6. What it does not do

It does not play the game for you, model how particular opponents behave, or simulate the Cities &
Knights rules (that switch only re-weights the same rules). The percentages are score shares, not win
probabilities.
