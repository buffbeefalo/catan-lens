# How Catan Lens works

Catan Lens answers one question: **where should I put my first two settlements?** It looks at every
legal corner on the board, scores each one with a small set of rules that strong players agree on, and
explains the result in plain sentences. No machine learning, no analysis backend, no randomness in the scoring:
the same position and settings give the same answer in the same app version, and every sentence in the "Why this corner?" panel is built
from the numbers that produced the score.

The web guide's demonstration videos have captions and text transcripts. A playback failure opens the
matching transcript; a failed or empty transcript download offers **Retry transcript**. The written
guide remains available below the videos.

## Put it to use

- **Plan a real opening together.** Set Players and Your seat before entering tiles. Open **Your board**
  and **Start blank**, paint the resources, add numbers, then finish or explicitly exclude harbours.
  Or choose **Read from a picture**: pick a screenshot or a photo taken from straight above, tap the
  number tokens on the four highlighted corner tiles, check the guesses (unsure tiles are outlined) and
  choose **Use these tiles**. Harbours are not read. The picture stays on your device. The reader was
  tested on generated pictures, not yet on many real photos, so compare every tile with your table.
  Mark opponents in placement order and use **Keep** for your own settlement when your turn comes.
  Before keeping your second corner, compare alternatives. On a base-game table, ask which resource
  you cannot produce and which first build needs the fewest new cards.
- **Practise a decision.** Choose **Drill**, set the table and start. Commit before seeing the answer,
  then read why the model preferred another corner. Replay a cleared level to practise the same
  situation on another board; a close score is a prompt to compare tradeoffs, not a predicted win rate.
- **Review an opening with friends.** Use **Copy link** to share the entered position and settings.
  Copy from **Your board** when you want explicit tiles and harbours in the saved link. Generated links
  use a seed and the app's current setup rules; scoring can change when the app is updated.

- **Install it on your phone.** On Android, open the app in Chrome and choose **Install app** or **Add to
  Home screen** from the browser menu. On an iPhone or iPad, open it in Safari, tap **Share**, then **Add
  to Home Screen**. It opens full screen like an app, with the same links and no account.

**Weak connection at the table?** Open the app once while connected. Most browsers then keep an offline
copy, so the board page and the help page open and refresh without a connection; videos still need one.
Copying a link preserves the current position; opening it on another device needs the app to load there
once.

## 1. The board

The app draws the standard 19-hex board (or the 30-hex 5–6 player board), following the official
"variable setup": shuffle the land tiles, lay the number tokens in the official spiral order, deal the
harbours around the coast. With **Balanced setup** on, it keeps red numbers (6 and 8) from touching, as the
rulebook asks. A generated-board link reopens its seed using the app's current setup rules; a Your board
link stores the entered tiles and harbours explicitly.

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
Opening **Your board** by keyboard focuses the first tool. Activate a tool with Enter or Space to
focus the first hex or coastal edge; Tab moves through the board and Enter or Space edits it. Escape
returns from the board to the selected tool. Opening a number picker focuses the current token; Tab
chooses another token and Escape returns to its hex, then another Escape returns to Numbers.
The number picker brings its choices into view, including when editing guidance is expanded.
Choosing a blank or desert hex brings its explanation into view instead: paint a resource before
numbering a blank hex, while a desert has no token. Escape returns from this message to its hex.
Painted tiles, changed harbours and selected tokens keep keyboard focus as the board redraws.
Choosing Players or Your seat also keeps focus on that button, so Tab continues from the choice
you just made instead of restarting the group.
When the device uses a high-contrast palette, selected controls use its highlight colours, the current
Drill level keeps an outline, and focused board corners remain visible against the page.
Settlement taps and mouse clicks choose the closest corner within a limited reach. Tapping near a
blocked corner does not redirect to another corner; your own settlement still needs **Keep** to confirm.
With Ports selected, a tap near the coast changes its closest edge. Tile centers do not change ports.
Keyboard and assistive-button activation select the focused corner or coastal edge directly.
Changing between the 19-hex and 30-hex layouts starts a blank board of the new shape. The app keeps
the previous board in this tab's history: **Restore previous board** or the browser's Back button
recovers its tiles, harbours, table settings and placements, even after a refresh. Start blank,
Random board and leaving Your board for Explore provide the same recovery. In Explore, New board,
changing the seed, and toggling balanced numbers also keep the previous board. **Clear** removes only
the placement marks and offers **Restore cleared pieces**, including their original Undo order.
Clearing an empty board or entering the same seed does not discard that recovery point. A shared link contains
only the current board; recovery history belongs to the original tab. Changing 3↔4 or 5↔6 players
keeps the entered board and placements because its shape has not changed.
Recovery focuses the restored panel heading and brings it into view, including on short screens.
If the browser temporarily refuses link updates, a warning appears and editing still works. **Copy
link** uses the board currently shown, even if the address bar is behind. Keep the tab open, wait a
moment and choose **Retry link update** before refreshing. If a recovery checkpoint or a Drill mode
change cannot be saved, that change is not applied; the current board and pieces stay in place.
If a board link cannot be read, the app shows an error and keeps the original link in the address bar.
It gives no settlement advice until you open a readable board or explicitly start again. If the saved
tiles and harbours match the other board size, choose one of the offered player counts to recover the
board and its settlement marks. Valid unfinished boards still open for editing. Numbers on deserts or
blank tiles and duplicate harbours on the same edge are rejected instead of silently discarded.
**How it works** carries your current board link into the help page. **Back to the app** reopens that
board, table settings, harbour choice and placement order, including after refreshing the help page.
When help was opened from the matching app link in this tab, returning uses the existing browser
entry, retaining its private Drill return board and placement tool. Direct help links and new tabs
open only the state carried in their link; they do not acquire another tab's private return board.
Unreadable board data is also preserved so visiting help does not discard the link you need to repair.
The help return link is ready before its theme control loads; a failed theme download does not block
the transcripts or benchmark display either.
If the app cannot finish loading, **Reload this board** retries while keeping the board link and this
tab's Drill return point. Check your connection first. The loading screen also keeps **How it works**
available with your current link. With JavaScript turned off, it explains how to enable the interactive
board and offers the written guide in a new tab.

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
| Repeated numbers | Extra production on the same number does not add another paying roll; a small penalty. |
| Harbours | When included, a 3:1 harbour helps anyone; a 2:1 harbour helps most when you produce plenty of that resource. A nearby harbour needs two roads and a new settlement before you can use it, including when those roads approach from inland. A type you already own adds no bonus. Useful direct access takes priority; otherwise only the best reachable new harbour counts. |
| Room to grow | Adds value for an open settlement site exactly two roads away. Longer routes are outside this factor. |
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
  its rank and its score share (or point gap when a percentage is unsuitable), and explains why a higher-ranked corner scores
  better. A score share such as "92% of best" compares model scores; it is not a chance of winning. When the choice comes down to small differences between the same kinds of bonuses, it compares
  the actual score terms. A corner can produce more raw cards yet score lower because of its resources;
  the explanation acknowledges that tradeoff. Equal scores share the top rank without a claim that one
  tied corner is better. When number repetition matters, the comparison gives each corner's actual
  penalty; both corners can repeat the same number, but one may repeat it more often.
  Scores show hundredths. Percentages are rounded down to at most two decimal places, so a lower
  score cannot look like a 100% tie or cross the 90% grade boundary through display rounding.
  A negative pick score or a nonpositive best score uses the point gap instead: these heuristic scores
  can cross zero on unusual custom boards, where a percentage is not a useful comparison.
  The rounding step also removes tiny arithmetic errors at halfway boundaries, so turning the same
  physical board does not change a score merely by changing the order in which its hexes are counted.
- **Opponents.** Switch to "Mark opponent" and click where others placed; the ranking only counts what is
  still open.
- **Projected placements.** Placement is a snake draft (seats 1 to N, then N back to 1). The app fills
  unmarked turns with its own highest-ranked legal choice for each seat. Actual players can choose
  differently; this is an opening scenario, not a prediction of a particular opponent.
- **Starting road.** For each settlement the app suggests which way to point the free road: toward the
  best open corner two roads away, preferring a direction with more than one option. It considers the
  other seats' remaining setup placements, including turns after your second settlement. The card
  names projected conflicts and warns when its target is also your own projected second settlement:
  following that opening would occupy the site during setup. With **Show best** off, road hints stay
  hidden in both the map and earlier verdicts until you reveal them; committed-pick grades remain available.
  When no two-road destination is legal, the card states that limit. The hint does not check longer routes.
- **Your starting road.** After keeping a settlement, tap one of its sides on the board to place its
  starting road (by keyboard, Tab to a side and press Enter). The card grades that direction with the
  same reasoning as the suggestion: **Great** for the best direction (exact ties share it), **Fair** when
  its best two-road target scores at least 90% of the best direction's, **Weak** for anything lower or
  when nothing that way survives the projected opening. If no direction has an open site two roads
  away, the card explains that limit instead of grading. Tap another side to move the road; Undo puts
  it back. The road is judged as of its settlement's turn, so marking opponents afterwards does not
  change its grade, and outside Drill the road suggested for a kept settlement is worked out as of that
  turn too: following it always earns Great. If your road grades Fair or Weak, the suggested side is drawn
  dashed beside it; a Great road, even on another side tied for best, is never shown a different one. With **Show best** off, the card only confirms that the road is placed
  until both of your settlements are down; then it shows the bare grade. Why, what lies that way and how the
  other directions compare wait for **Show best**. Opponents' roads are not entered, and routes longer than
  two roads are not checked. Drill does not use roads.

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

### Try the same corners in the opposite order

These two base-game links store the same tiles, harbours and settlement locations. Only the order of
your settlements changes. Both average 22 cards per 36 rolls, collect on 14 of the 36 dice outcomes,
and lack wood production.

| Starting hand and example | Road still needs | Development card still needs |
| --- | --- | --- |
| [Brick, wheat and sheep](https://buffbeefalo.github.io/catan-lens/?players=4&seat=1&cak=0&bal=1&best=1&rseat=0&b=b3s8b10w6o4h5o9s2o9s11w6w12h5db3w11h10h8s4&h=5%3A3%2C6%3Ab%2C19%3As%2C27%3Ah%2C46%3Ao%2C52%3A3%2C60%3A3%2C64%3A3%2C67%3Aw&me=9%2C44&seq=m9%2Cm44) | 1 wood | 1 ore |
| [Ore, wheat and sheep](https://buffbeefalo.github.io/catan-lens/?players=4&seat=1&cak=0&bal=1&best=1&rseat=0&b=b3s8b10w6o4h5o9s2o9s11w6w12h5db3w11h10h8s4&h=5%3A3%2C6%3Ab%2C19%3As%2C27%3Ah%2C46%3Ao%2C52%3A3%2C60%3A3%2C64%3A3%2C67%3Aw&me=44%2C9&seq=m44%2Cm9) | 1 wood and 1 brick | Hand covers cost |

Open **Plan your first builds** under Your opening to inspect the difference. Starting cards come from
the second settlement; changing its order changes the immediate options without changing production.
The comparison uses the starting hand before rolls or trades, and buying still needs your turn. In a
real draft, mark opponents first to check which locations remain available.

### Your plan and the look-ahead ranking

**Your plan.** By seat follows R10: early seats chase ore, wheat and sheep for cities and development
cards, later seats lean on wood, brick and harbours. Under **Your plan** in Table settings, choose
**Cities** or **Roads** to rank your own corners for that plan instead. The other seats keep the seat rule
in every projection, and Cities & Knights keeps its own weighting.

**Look-ahead (experimental).** The classic ranking scores one corner at a time. Under **Ranking**, choose
**Look-ahead** and your next settlement is ranked for your turn by the opening it leads to: the corner plus
the best second settlement the projected draft leaves you, the safe second pick strong players describe.
Seats that pick before you and have not placed are projected first, so a corner they are expected to take
is not ranked; you can still try it. Each settlement keeps its classic score, except that its harbour and
room-to-grow credits count only a spot still open when setup ends, and a corner or harbour type both
settlements could use counts once.

The card shows both settlements' parts, names the projected second settlement and a credible alternative
with the resource tradeoff, and says what the projection assumes: every seat that has not placed picks by
the classic model, in turn order. A real table can differ. **Other ways the table could pick** ranks the same
position again with those seats taking the most pips, or the most new resources, and says where the
recommendation lands; it never changes the ranking. Grades and percentages compare opening values. The
look-ahead is for the base game: in Cities & Knights your second piece is a city, which it does not model.
Drill always uses the classic ranking.

Why add it: in 1,200 simulated four-player positions (300 boards, every seat), taking the best corner
alone and then the best second corner left gave a weaker two-settlement opening, by the model's own
scoring, on 45.3% to 64.7% of boards depending on the seat. The room-to-grow corner credited to the classic
top choice was taken or blocked by another seat by the end of setup 77.0% of the time
(`node bench/draft-diagnostics.mjs 300`). These are model diagnostics, not game results.

## 4. Drill mode

Sixteen levels, easy to hard, on a table you choose first (3–6 players, base game or Cities & Knights
weighting). Hints stay hidden until you commit. Early levels accept any of the top three corners on boards
with an obvious winner; later levels demand the exact best corner on near-ties, from any seat, for the
first or the second settlement. Miss, and you get a new board at the same level.
The app searches up to 120 seeds for the usual difficulty. A shared seed or an exhausted search can
produce a board outside that range; a notice says so without revealing the answer. The notice follows
the actual board through refreshes, and the same pass rule still applies. **New board** tries again.
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

The current policy completes the search for legal harbour destinations two roads away, including
approaches from inland. Its separate 24,000-game test gave corrected Lens **1,981 wins out of 8,000**,
versus **1,980** immediately before the correction and **2,015** for the bot's own opening. The primary
paired difference was **+0.0125 percentage points** (approximate 95% interval: **−0.7705 to +0.7955**).
It does not establish a win-rate advantage or prove equal policies: 488 matched games changed to a win
and 487 to a loss. Against the bot's own opening, the difference was −0.425 points (−1.7202 to +0.8702).
Both versions already include the ownership and rounding corrections. The fix follows legal access,
independently of these outcomes. [Frozen inputs and raw games](../bench/catanatron/results.md#harbour-reachability-correction-2026-10-09)
document the comparison without pooling it with earlier tests or tuning on its outcomes.

The earlier owned-harbour policy avoids rewarding a harbour type you already own. A separate 24,000-game comparison
on 8,000 new boards gave it **1,972 wins**, versus **1,976** before the correction and **1,985** for the
bot's own opening. The correction's difference is **−0.05 percentage points**, with the planned approximate
95% interval from **−0.098 to −0.002**. Only four win/loss pairs changed, all against the correction;
this narrow estimate rests on very few differences. It does not show a win-rate gain or prove equal
policies. Against the bot's own opening, the difference is −0.16 points (−1.67 to +1.35), which remains
uncertain. [Frozen inputs, exact counts and raw games](../bench/catanatron/results.md#owned-harbour-correction-2026-10-09)
keep this test separate from those below. No policy was tuned on these results.

The app also corrects tiny arithmetic errors at half-cent scoring boundaries. The newest comparison
contains that repair in both versions, so it does not measure the repair's separate effect on winning.

This table is the **earlier policy's 2026-10-09 fresh-seed test**: 20 bot tie-breaking seeds and 8,000 board seeds that
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

**Starting roads.** The original 2026-09-29 comparison used 400 openings. Before the road rule considered
the projected remaining placements, 52% of first roads had no legal settlement site one road beyond
them after setup. The revised rule reduced that observed figure to 22%, versus 42% for the bot's road
choice. These are historical measurements of those policies, not new rates for today's scoring policy
or a promise about human opponents. The app still checks projected placements and explains contested
targets; each full-game test above records the exact policy it measured.

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
