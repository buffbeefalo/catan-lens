# What strong Catan players say about opening placement — and how Catan Lens encodes it

Compiled 2026-09-14. Every scoring rule in `public/score.js` cites one of the numbered sources
below, and the app's "Why" panel quotes the same reasoning in plain English. Sources are ranked by
how much competitive weight they carry.

## Sources

1. **King of Catan — "Initial Settlement Placements: Production"** (written by 12 expert players from
   the King of Catan community, which runs the Catan Premier League / PCL rankings and coaching).
   https://kingofcatan.net/initial-settlement-placements-production/
2. **King of Catan — "Initial Settlement Placements: Flexibility"** (same 12-player author group).
   https://kingofcatan.net/initial-settlement-placements-flexibility/
3. **Alex Cates — "Are 6s and 8s really that great?"** (data analysis of ~400 Colonist.io games).
   https://www.alexcates.com/post/are-6-s-and-8-s-really-that-great
4. **Alex Pomeranz — "The Almost Complete Cities and Knights Strategy Guide"** (BoardGameGeek strategy
   forum, the standard C&K reference). https://boardgamegeek.com/thread/97451/
5. **Settlr blog — "Catan Setup Strategy: How to Place Your First Two Settlements"**.
   https://www.playsettlr.com/blog/catan-setup-strategy-first-two-settlements
6. **Colonist.io blog — "What are the Best Catan Starting Strategies?"** and the beginner/advanced guide
   (Colonist is the main competitive online Catan platform; Bo Peng, former US champion, is quoted
   on committing to a win condition from the opening).
   https://blog.colonist.io/guide-to-catan-starting-strategies/
7. **Catan Almanac (settlersboard.com)** — tournament-oriented articles on openings, turn order, ports
   and the 5–6 board (site blocks scrapers; the search excerpts are what was used).
   https://settlersboard.com/blog/how-to-win-at-catan

8. **Colonist.io interviews — Bo Peng (US champion) and DyLighted (Colonist champion)** (2026-09-15 pass).
   Bo: a "6/5/9 ore/wheat/sheep spot is the equivalent of pocket aces"; otherwise "a spot which would guarantee a
   safe 2nd settlement pick"; placement decides "about 50%" of the game; wheat is "the most flexible resource".
   DyLighted: "production and the resource type along with its rarity"; "No Wheat = Defeat"; placement ≈ 25%.
   https://blog.colonist.io/bo-peng-interview/ · https://blog.colonist.io/interview-series-1-dylighted/
9. **Dovetail / Catan Console Edition — "Play like a world champion with Quetzal Hernández"** (world champion):
   start by establishing the scarcest resource on the board, then choose the plan and the spots.
   https://live.dovetailgames.com/live/catan-console-edition/articles/article/play-like-a-world-champion-with-quetzal-hernandez
10. **King of Catan — "Behind the Hexes" player profiles** (PCL top players). EBOX: "It's nice to get 6 different
    numbers on your placements, especially placing on an 8 and a 6 (8 and 6 hedges the dice, and covers 10/36 of
    dice rolls versus 5/36 if you are doubled)". https://kingofcatan.net/behind-the-hexes-ebox/
11. **Starting-road guides** — Board Game Business "Strategy Primer", playiro "Catan Openings for New Players",
    Instructables "Catan Strategy Guide", Mark's Settlers Strategy Guide (mark.random-article.com/settlers/), and the
    Colonist starting-strategies guide (source 6). All agree: the free road must point at an open corner you can
    reach, preferably one that leaves you options ("build toward a double intersection away from your opponents'
    settlements"), away from the crowded middle, toward a port only when you can feed it; never into a dead end
    or a single-hex corner. Mark's guide adds: with 5 or 6 different numbers across both settlements you collect far
    more evenly.
12. **Guhe & Lascarides, "Game strategies for The Settlers of Catan" (IEEE CIG 2014, JSettlers agents)**: an
    agent whose initial placement disfavours repeated numbers, disfavours putting both settlements on the same hex,
    and weights resource combinations by the pieces they build beat the stock agent so badly the stock agent won
    only 15.2% of four-player games — "decisions about the initial setup are critical".
    https://homepages.inf.ed.ac.uk/alex/papers/cig2014_gs.pdf
13. **Catanatron (bcollazo, open-source strong Catan AI) value function**: own production and *enemy* production
    carry equal and opposite weight (1e8 / −1e8), a small bonus per distinct resource, and "reachable production"
    one road away (1e4) far above "buildable nodes" (1e3) — i.e. a strong bot also values where its roads can
    reach next. https://github.com/bcollazo/catanatron (catanatron/players/value.py)

## What is source-backed and what is the author's choice

The sources give directions and a few thresholds (production first; wheat/ore over sheep; about 10 pips per
spot; a 2:1 port needs plenty of that resource behind it — the sources say roughly 7+, the app credits a fed port from 5 pips (author's choice, so 4-player coastal corners are not written off); count marquee numbers; spread your numbers; ore first in C&K).
The **numeric coefficients** in the right-hand column below are the author's choices that encode those
directions. They were tuned by one rule, tested computationally: production stays dominant (see R1).
Nobody should read the scores as expert-certified numbers; the *ordering principles* are the experts',
the *weights* are ours.

**The pick grade (added 2026-09-14) is presentation, not a rule.** After a settlement is placed the app
grades it against the corners that were open at the time: *Great* = the #1 corner; *Good* = one of the top
N where N is the player count (the corners an N-player table fights over — the same reason the top list
shows N entries); *Fair* = outside the top N but still ≥ 90% of the best corner's score; *Weak* = below 90%.
The N-per-player idea follows the seat-based advice in R10 (what is left when your turn comes depends on how
many players pick before you); the 90% line is the author's choice. The percentage is the pick's score as a
share of the best open corner's score, not a win probability.

**Drill mode (added 2026-09-14 late) is a ladder over the same heuristic.** You set the TABLE before you start
(2026-09-15: players 3–6 and the Cities & Knights weighting are chosen on a setup card; every level runs on that
table and each table keeps its own progress track, so the ladder no longer switches tables on levels 1, 12–13 and
14–16). Sixteen levels (one straight ladder, no worlds) fix a scenario (your seat as a position in the order —
first, second, middle, second-to-last, last — resolved for the table size; which seats have already placed — taken
from the projected draft so they are the corners strong players would take — first or second settlement) and ramp two dials: the pass
rule (top 3, top 2, then exactly the best corner) and the board's clarity (the score gap between the top two
corners you can choose from; early stages require a wide gap, late stages search seeds for a near-tie). A
wrong pick lets you scramble to a fresh board at the same level; a right one advances; past level 16 the
hardest level repeats. Thresholds are the author's choice; nothing in the scoring changes.

**Audit 2026-09-15.** A systematic bug audit confirmed 54 defects (3 high, 14 medium, 37 low); all were fixed
the same day. Scoring-visible ones: R6 no longer charges a duplicate inside your own first settlement to
every second-settlement corner; R7 credits a port one road away only when its far end can still be settled;
R8 lists every expansion value it scores (parts now add up to the score exactly); R9 starting cards count one
per hex; the scarcity cap moved 1.3 → 1.25 (see R3); the number spiral is now continuous like the official
one; "the most on the board" is measured board-wide; ties share rank 1; the comparison never lists something
the pick already has. The rest were page-state defects (drill re-answer through the projected list, score
leaking before commit, reload losing placement order, hostile links crashing the page, and so on).

**Your board (added 2026-09-15) enters the real board.** Catanalyzer (catanalyzer.vercel.app), a board analyser that
scores corners by roll probability and a fixed resource weight, showed the value of entering the board in front of
you; that idea was borrowed. "Your board" starts from the board
on screen; paint resources, tap a hex then its token, tap coastal edges to cycle harbours. A blank or desert hex
never carries a number and produces nothing. The link carries the board (`b=` one letter per hex plus its number,
`h=` edge:harbour pairs); a check lists differences from the official box (advice, never a block); balance is
measured from the entered numbers. Every existing rule then applies unchanged — nothing in the scoring moved.

## Rules the experts agree on → how the app scores them

| # | Rule (plain English) | Source(s) | Encoded as |
|---|---|---|---|
| R1 | **Production first.** Count the pips (dots) on the three number tokens around a corner; 6 and 8 carry 5 pips, 2 and 12 carry 1. A spot should reach about 10 pips; the best spots on a board are 11–13. "One should never underestimate the brutal power of production." | 1, 5, 7 | Base score = weighted pips (raw pips × resource weight × scarcity). Every other term is a bonus or penalty on top, sized small. Empirical check, not a proof: over 400 generated boards (200 seeds × both layouts) the top-ranked corner is always within 4 *raw* pips of the board's highest-pip corner, in first-settlement mode and in second-settlement mode (`test/score.test.js`). |
| R2 | **Wheat and ore are the most valuable resources** (cities and development cards, the two most powerful plays). Sheep is the weakest. | 1, 4 | Resource weights: wheat 1.15, ore 1.15, wood 1.0, brick 1.0, sheep 0.9. |
| R3 | **Scarcity.** A resource with few strong numbers on THIS board is worth more — you can trade it at a premium and nobody can block you out of it. The C&K guide counts "marquee" numbers (5, 6, 8, 9) per resource; King of Catan reasons from the resource's total production. | 1, 2, 4, 6 | The app uses total pips (a finer version of the marquee count): each resource's weight is scaled by (expected pip share for its tile count ÷ actual pip share on this board), clamped to 0.8–1.25. The cap matters: at 1.4, two ore tiles on 3 and 11 outranked a 13-pip corner, which no source supports; at 1.3 a 7-pip ore/wheat port corner outranked a 13-pip corner for a second settlement on one 6-player board (2026-09-15 audit), so it came down to 1.25. |
| R4 | **Complementary pairs.** Wood+brick are always spent together (roads); wheat+ore build cities. Getting both halves of a pair from one spot is worth more than the sum. | 2 | Up to +0.6 for wood+brick and +0.9 for wheat+ore, scaled by the weaker half (full value once the weaker resource has 3+ pips, so 1 pip of ore next to 5 wheat earns a third). |
| R5 | **Don't fear the robber on 6/8.** Data from ~400 online games: realized production matches theoretical pips; do not discount red numbers for fear of being robbed. | 3 | No robber penalty. (An earlier draft had one; removed on this evidence.) |
| R6 | **Spread your numbers.** Duplicated numbers mean feast-or-famine and more 7-roll discards. But doubling up is fine when the spot is clearly the strongest, so this is a nudge, not a veto. | 2, 4, 5 | −0.75 per number repeated within a spot or between your first and second settlement. |
| R7 | **3:1 ports are the ones top players value most; 2:1 ports only pay when you already overproduce that resource.** Ports on a coastal corner cost production (two hexes instead of three), so a port must earn its keep. | 1, 2, 6, 7 | Port on the corner: 3:1 +1.0; 2:1 +1.5 when you hold ≥5 pips of that resource (this corner plus your other settlement), else +0.25. Only the single best port counts (never stacked). A port one road away scores half. |
| R8 | **Leave yourself room to grow.** A strong open corner two roads away is worth more than a slightly better isolated spot; avoid dead ends and single-hex corners; don't rely on the crowded middle. | 5, 7, 6 | +10% of the pips of the best legal corner exactly two roads away (still legal after you settle, i.e. not blocked by the distance rule). |
| R9 | **The second settlement patches the first.** Cover the resources you are missing (especially wheat and ore), keep pips high, avoid repeating numbers, and remember it hands you one card per adjacent hex. | 1, 5, 6 | In "second settlement" mode: +1.0 per resource the first settlement lacks (+1.5 if it is wheat or ore); number-repeat penalty applies across both; the panel lists the starting cards. |
| R10 | **Turn order shapes the plan.** The first half of the seats (1–2 at a 4-player table, 1–3 with 5 or 6 players) take the best wheat/ore production (Ore-Wheat-Sheep plan). The later seats usually cannot, so they lean on wood/brick for Longest Road, ports, or cornering a scarce resource. | 1, 6, 7 | Seat setting picks a plan: seats 1–2 use the weights in R2; later seats use wood 1.15, brick 1.15, wheat 1.0, ore 0.95, sheep 0.9 and a 1.5× port bonus. |
| R11 | **Cities & Knights changes the values.** Ore is "of extremely high value" (cities produce only 1 ore, knights need it); wheat is a necessity (activating knights before the barbarians); wood matters (green progress cards, aqueduct); brick is low; sheep moderate. Cities on wood/sheep/ore hexes also produce commodities. Ports matter less. Avoid 2/3/11/12. | 4 | **Weighting only.** The C&K switch re-weights the same placement heuristic: ore 1.35, wheat 1.15, wood 1.1, sheep 1.0, brick 0.8; +0.5 per adjacent wood/sheep/ore (commodity) hex; port bonuses halved; 1–2 pip tokens count 0.75×. It does not simulate the starting city's production, commodities, knights or barbarians. |
| R12 | **5–6 player board.** Same principles; the second desert makes one-desert corners among the weakest spots; clustered reds are more common, so balanced setup matters more. | 7 | Handled by the geometry: desert hexes contribute 0 pips. The generator lays the official token sequence in an outer-to-inner spiral (six rotations tried); if every rotation puts a 6 next to an 8 on the stretched board it falls back to shuffled tokens with rejection, and if that is exhausted too the board is returned flagged as not balanced (the page says so) rather than mislabelled. |
| R13 | **Point your starting road at the best corner you can reach.** The free road that comes with each settlement should aim at an open corner two roads away — preferably a direction that keeps more than one option open ("a double intersection"), away from the crowded middle, toward a port only when you can feed it; never into a dead end. | 6, 11, 13 | **Not a score term — a recommendation.** `suggestRoad()` picks, for each of the settlement's free neighbouring corners, the corners one road further on that stay legal once the settlement is down, scores them with the ordinary ranking (so a fed port or a resource you lack counts), and takes the direction whose best target scores highest, breaking ties by how many open corners lie that way. The map draws the road; the card says why. If every corner two roads away is taken it says so instead of inventing a road. **Since 2026-09-29 a target must also survive the rest of the opening draft** (source 8: Bo Peng's "a spot which would guarantee a safe 2nd settlement pick"; source 11: build away from opponents): the draft is played forward with the same projection as the map badges, and corners that other seats are projected to take or block before your next turn are skipped; the card names the better-looking corner it skipped and why. If no direction survives, the road aims at what is open now and says every direction is contested. Measured on the same 400 simulated openings (`bench/catanatron/road_deadends.py`), the first road ended in a dead end once setup was over 52% of the time before this change and 22% after (the Catanatron bot's own first road: 42%). |

## What was deliberately left out (and why)

**Considered on the 2026-09-15 research pass and NOT adopted (yet):**
- *A denial term* (Catanatron weights enemy production as much as its own; several guides say "the spots you block
  are as important as the one you take"). It would change every score and needs its own tuning against the 4-pip
  rule; parked. The projected-placements card already shows what each seat is likely to take.
- *Tournament-style board constraints* beyond 6/8 separation (2 and 12 apart, no identical numbers touching,
  a pip cap per corner). The 2025 rulebook only forbids 6 next to 8; the rest are generator conventions
  (settlersboard.com/rules, thisisrandy/catan-randomizer). Adopting them would silently change every seeded board
  and the drill ladder's seed search, so it stays a possible future "Tournament setup" switch.
- *Catan Almanac's claim that brick is the resource most often in winning openings and that 14+ pip openings win
  60% more* — no data source is named; not used.
- *Woody Hayday's Catan Trainer* (the only other placement trainer found) scores number-distribution awareness
  only and ignores tile type; nothing to borrow beyond confirming the drill idea.

- **Simulated opponent *behaviour*.** Real placement is a snake draft; which spots are still open when
  your turn comes depends on the other players. The app ranks every legal spot on the board and re-ranks
  after each piece you place, which is what a player actually needs at the table. Since 2026-09-14 (late)
  it also draws a **projected draft** on the map: seats 1..N then N..1, each taking the best legal corner
  under its own seat plan (R10), second picks complementing the seat's first (R9), with pieces already on
  the board consumed in turn order. That projection is the heuristic applied greedily, not a model of how
  particular opponents play; the ranking itself never depends on it, and the user's own marks always win.
- **Robber penalty.** See R5.
- **LLM-written explanations.** Every sentence in the "Why" panel is generated from the score
  components, so it is always true of the board in front of you.
