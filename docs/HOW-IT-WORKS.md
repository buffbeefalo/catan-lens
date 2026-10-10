# How Catan Lens works

Catan Lens answers one question: **where should I put my first two settlements?** It looks at every
legal corner on the board, scores each one with a small set of rules that strong players agree on, and
explains the result in plain sentences. No machine learning, no analysis backend, no randomness in the scoring:
the same board always gets the same answer, and every sentence in the "Why this corner?" panel is built
from the numbers that produced the score.

The web guide's demonstration videos have captions and text transcripts. A playback failure opens the
matching transcript; a failed or empty transcript download offers **Retry transcript**. The written
guide remains available below the videos.

## 1. The board

The app draws the standard 19-hex board (or the 30-hex 5–6 player board), following the official
"variable setup": shuffle the land tiles, lay the number tokens in the official spiral order, deal the
harbours around the coast. With **Balanced setup** on, it keeps red numbers (6 and 8) from touching, as the
rulebook asks. Every board comes from a seed, so a link always reopens the exact same board.

You can also enter the real board in front of you with **Your board**: paint the resources, set the
number tokens, tap the coast to place harbours. Settlement advice starts once all resources and number
tokens are entered, with at least one producing hex, and the harbour choice is settled. A complete standard
harbour set is included automatically. Otherwise finish entering it, choose **Ignore harbour effects**, or
confirm **Use these … harbours** for a custom layout. The last choice treats unmarked coast as having no
harbour. Shared links remember the choice; changing a confirmed custom port asks you to check it again.
Overlapping harbours must be repaired or excluded from analysis. **Show conflicting harbours** selects the
Ports tool, marks the affected coast and focuses its first conflict for keyboard repair. Excluding harbour
effects keeps the entered ports on the board while leaving them out of rankings, grades, projections and
road suggestions. If a tile or token is removed later, rankings,
grades, road suggestions, projections and the opening summary disappear until the input is repaired.
Your placed pieces and their order are kept during these edits. **Check board inventory** expands the
detailed tile, token and harbour differences from the standard box. Nonstandard land counts remain a
visible caveat, so house-rule boards can still be analysed. **Editing help** expands the full controls
without crowding the phone editor.
For keyboard entry, choose a tool, Tab to a hex or coastal edge, then press Enter or Space. Opening a
number picker focuses the current token; Tab chooses another token and Escape returns to its hex.
Painted tiles, changed harbours and selected tokens keep keyboard focus as the board redraws.
When the device uses a high-contrast palette, selected controls use its highlight colours, the current
Drill level keeps an outline, and focused board corners remain visible against the page.
Settlement taps and mouse clicks choose the closest corner within a limited reach. Tapping near a
blocked corner does not redirect to another corner; your own settlement still needs **Keep** to confirm.
Keyboard and assistive-button activation select the focused corner directly.
Changing between the 19-hex and 30-hex layouts starts a blank board of the new shape. The app keeps
the previous board in this tab's history: **Restore previous board** or the browser's Back button
recovers its tiles, harbours, table settings and placements, even after a refresh. Start blank,
Random board and leaving Your board for Explore provide the same recovery. In Explore, New board,
changing the seed, and toggling balanced numbers also keep the previous board. **Clear** removes only
the placement marks and offers **Restore cleared pieces**, including their original Undo order.
Clearing an empty board or entering the same seed does not discard that recovery point. A shared link contains
only the current board; recovery history belongs to the original tab. Changing 3↔4 or 5↔6 players
keeps the entered board and placements because its shape has not changed.
If a board link cannot be read, the app shows an error and keeps the original link in the address bar.
It gives no settlement advice until you open a readable board or explicitly start again. If the saved
tiles and harbours match the other board size, choose one of the offered player counts to recover the
board and its settlement marks. Valid unfinished boards still open for editing. Numbers on deserts or
blank tiles and duplicate harbours on the same edge are rejected instead of silently discarded.
**How it works** carries your current board link into the help page. **Back to the app** reopens that
board, table settings, harbour choice and placement order, including after refreshing the help page.
Unreadable board data is also preserved so visiting help does not discard the link you need to repair.

## 2. The score for one corner

A settlement touches up to three hexes. The score starts with **production** and adds a few small
bonuses and penalties. Production is the main score term. A regression test covers 400 generated boards
with seat 1, base-game weights and no opponents placed; its first pick and following second pick stay
within 4 raw pips of the best-producing legal corner. This is a sampled check, not a guarantee for every
draft position or the Cities & Knights weighting. The resource, repeat and coverage terms can favor a
corner with lower raw production; the explanation and opening summary show that tradeoff.

| Rule | What it means at the table |
|---|---|
| Production | Add up the dots (pips) on the surrounding number tokens: a 6 or 8 has 5, a 2 or 12 has 1. The pips are the number of ways, out of 36, that two dice roll that number. |
| Resource value | Wheat and ore build cities and development cards, so they count a little more; sheep a little less. Later seats lean toward wood and brick (a road-building plan). |
| Scarcity | A resource that is rare on *this* board is worth more: it trades at a premium and is hard to get elsewhere. |
| Pairs | Wood with brick (roads) or wheat with ore (cities) from the same corner earns a small bonus. |
| Repeated numbers | Two hexes with the same number means feast-or-famine rolls; a small penalty. |
| Harbours | When included, a 3:1 harbour helps anyone; a 2:1 harbour helps most when you produce plenty of that resource. A nearby harbour needs two roads and a new settlement before you can use it. |
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
  its rank and its score as a percentage of the best, and explains why a higher-ranked corner scores
  better. When the choice comes down to small differences between the same kinds of bonuses, it compares
  the actual score terms. A corner can produce more raw cards yet score lower because of its resources;
  the explanation acknowledges that tradeoff. Equal scores share the top rank without a claim that one
  tied corner is better. When number repetition matters, the comparison gives each corner's actual
  penalty; both corners can repeat the same number, but one may repeat it more often.
  Scores show hundredths. Percentages are rounded down to at most two decimal places, so a lower
  score cannot look like a 100% tie or cross the 90% grade boundary through display rounding.
- **Opponents.** Switch to "Mark opponent" and click where others placed; the ranking only counts what is
  still open.
- **Projected placements.** Placement is a snake draft (seats 1 to N, then N back to 1). The app plays
  that draft out with the same rules for every seat, so you can see what is likely to be gone before your
  turn comes back.
- **Starting road.** For each settlement the app suggests which way to point the free road: toward the
  best open corner two roads away, preferring a direction with more than one option.

### What your opening can produce and build

After the second settlement, **Your opening** shows average resource cards per 36 rolls, the chance of
receiving any cards, and the five-resource breakdown. For example, an opening can average 22 cards per
36 rolls while collecting on only 14 of the 36 possible dice outcomes: repeated numbers pay more cards
together, without making those numbers more likely. These are long-run averages before the robber,
trades or supply shortages; they do not promise a particular hand after 36 rolls.

The summary flags missing production and names the builds that need those resources. It lists the
starting cards from the second settlement and the bank rates available at your own harbours. Owning
another harbour of the same type does not improve those rates, so it adds no harbour score bonus;
the explanation calls out a duplicate on the corner. A different port can still improve your access. **Plan
your first builds** compares that starting hand with the costs of a road, settlement, city and
development card. Each row is a separate option, before further rolls or trades, and still requires a
legal build or purchase on your turn. **Which rolls pay?** lists the cards received on each dice total.

While previewing a second corner, **What this opening gives you** shows the same figures before you
commit. This preview stays hidden in blind practice and unanswered drills. After Keep, keyboard focus
moves to the result; on a phone the result moves into view. Excluding harbour effects also removes their
trade rates from this summary. In Cities & Knights mode, the app labels the figures as a two-settlement
comparison and withholds base-game build planning: its weighting switch does not model the starting
city or commodities.

## 4. Drill mode

Sixteen levels, easy to hard, on a table you choose first (3–6 players, base game or Cities & Knights
weighting). Hints stay hidden until you commit. Early levels accept any of the top three corners on boards
with an obvious winner; later levels demand the exact best corner on near-ties, from any seat, for the
first or the second settlement. Miss, and you get a new board at the same level.
After a miss, the result shows the point gap to the top score. A pick within 1% of the best score is
identified as a close model comparison; it can remain a good real-game choice even though the exercise
requires the app's exact top rank. Neither the score share nor a small gap measures winning chances.
The level track uses keyboard buttons: cleared levels can be replayed with Enter or Space, while locked
levels remain disabled until you clear the preceding level.
Progress is saved in this browser, separately for each table. If reading or saving is blocked, a visible
warning offers **Retry saving**. You can keep practising in the current tab, but unsaved progress may be
lost on reload or closing. A retry preserves the latest saved progress for other tables; a failed reset
is also retried as a reset. Clearing browser storage in another tab updates the displayed flags. Saved
levels are checked for valid table names, duplicates and the supported level range before being used.
Leaving Drill restores the board, table settings and settlement order you were exploring before entering
it, including a hand-entered board and the selected placement tool. The current tab's history entry
keeps that return point through a refresh, both during table setup and in an active exercise. Setup
links reopen table selection; exercise links reopen their level. Neither link contains the earlier
exploration board, so opening one in a fresh tab cannot restore another tab's board. An older
**Restore previous board** checkpoint remains available after the Drill visit.

## 5. Does following it actually win games?

The rules come from expert advice, but advice is not proof, so the repository tests it three ways.

**Full games.** [`bench/catanatron`](../bench/catanatron) plays complete four-player games in
[Catanatron](https://github.com/bcollazo/catanatron), an open-source Catan engine with strong bots. All four seats
are Catanatron's value-function bot; one seat has its opening chosen by a different strategy, then plays the rest of
the game exactly like the others. A fair seat wins 25%.

This table is the **2026-10-09 fresh-seed test**: 20 bot tie-breaking seeds and 8,000 board seeds that
were not in the earlier benchmark. The policy was frozen before the test, and its outcomes were not
used for tuning. All 40,000 games finished. [Methods, raw games and the original result](../bench/catanatron/results.md)
are available for checking. A same-seed replication reproduced the original table; it is kept separate
from this new test.

| Opening chosen by | Win rate (95% interval) | Games |
|---|---|---|
| Catan Lens settlements and road | 24.3% ± 1.1 | 8,000 |
| Catan Lens settlements, bot's roads | 23.5% ± 1.2 | 8,000 |
| The bot's own opening | 24.5% ± 1.2 | 8,000 |
| Most pips | 16.4% ± 1.1 | 8,000 |
| Random corner | 1.5% ± 0.2 | 8,000 |

Comparing strategies within each run gives Lens a **7.9 percentage-point advantage over most-pips**
(95% interval: 6.5 to 9.3). Its difference from the bot's own opening is **−0.2 points** (−1.8 to +1.3).
The second interval includes both a disadvantage and an advantage, so it does not establish which is
better or prove equal performance.

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
resources, spread across more numbers, and hold more of the wheat/ore pair that builds cities. This report
describes the tradeoffs; the game benchmark measures their combined effect.

What this says, and what it does not:

- Lens outperformed the popular "take the corner with the most dots" rule in this bot test. The comparison
  with the strong bot's own openings remains uncertain within the reported interval.
- Bots trade and plan differently from people. These results support the policy in the tested setting;
  they do not establish a person's improvement or winning chances.
- The simulation covers the four-player base game only.

## 6. What it does not do

It does not play the game for you, model how particular opponents behave, or simulate the Cities &
Knights rules (that switch only re-weights the same rules). Score percentages are score shares, not win
probabilities.
