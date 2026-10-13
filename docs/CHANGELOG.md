# Changelog

Dated changes to the scoring, its explanations and the evidence, newest first. The rules themselves and their
sources live in [RESEARCH.md](RESEARCH.md); benchmark evidence lives in
[bench/catanatron/results.md](../bench/catanatron/results.md).

## 2026-10-12

**Exact tests and an erratum.** Every archived paired comparison now also has an exact two-sided McNemar test on
its changed win/loss pairs, recomputed from the raw games in continuous integration
([exact tests](../bench/catanatron/results.md#exact-tests-on-changed-pairs-2026-10-12)). Erratum for the
owned-harbour comparison of 2026-10-09: its approximate t interval (−0.098 to −0.002) excluded zero only because
the changes were sparse; 16 of the 20 cluster differences were exactly zero, so that interval is not a valid basis.
The exact test on the four changed pairs (none favour the correction) gives p = 0.125: no significant difference.
The conclusion (no demonstrated gain, no proof of equivalence) is unchanged.

**Look-ahead ranking, experimental (policy `draft-aware-2026-10-12`).** A second ranking, off by default, ranks your
next settlement for your turn by the opening it leads to (rule R14). Seats before you that have not placed are
projected first; a first settlement is valued with the best second settlement the projected draft leaves you, and
that second is the one that makes the whole opening best. Each settlement keeps its classic score, but its harbour
(R7) and room-to-grow (R8) credits count only spots still open when the projected setup ends, and a corner or harbour
type both settlements could use counts once. It is offered for the base game only (a Cities & Knights second piece is
a city). A report-only check shows where the recommendation lands if the other seats pick by most pips or by new
resources. The classic ranking, its weights and its published results are unchanged; old links keep it. Drill stays
classic.

**Plan choice.** You can choose the plan for your own seat (Cities: ore, wheat and sheep; Roads: wood, brick and
harbours) instead of the seat rule (R10). No coefficient changed; the other seats keep the seat rule.

**Installable app.** The site can be installed on a phone's home screen and keeps an offline copy.

**Read a board from a picture.** In Your board, a screenshot or a top-down photo plus four taps on the corner
tiles' number tokens gives a guess for every tile and number. Nothing changes until you accept; unsure tiles are
outlined, and harbours are not read. The picture stays on the device. On nine generated test pictures (app
screenshots, flat drawings and photo-like renders at an angle with uneven light, blur, noise and compression), read
with exact and with slightly misplaced taps, every tile and number came out right. A tenth picture in colours the
reader does not know had every tile flagged. Real photos have not been measured, so check every tile.

**Faster scoring, same scores.** Per-board caches and a narrower legality check. 8,600 rankings (483,874 corner
scores with every part and sentence), 900 projected drafts and 3,100 road hints matched the previous code exactly.

**Why this corner? starts open.** The reasons are the product; blind practice and Drill still show nothing before
a commit.

## 2026-10-09

**Fresh-seed check, 2026-10-09.** A predeclared 40,000-game test of the frozen opening policy used
20 new bot tie-breaking seeds and 8,000 new board seeds. Lens settlements and roads won 24.3%, versus
24.5% for the value bot's own opening and 16.4% for most-pips. Paired 95% intervals put Lens minus
value at −1.8 to +1.3 percentage points and Lens minus most-pips at +6.5 to +9.3. This supports the
policy relative to most-pips in the tested four-player bot setting; it establishes neither superiority
nor equivalence to the value bot, human improvement, or other rulesets. No weights were tuned on these
outcomes. The [raw games, frozen inputs and reproduction method](../bench/catanatron/results.md)
remain separate from the original benchmark and its same-seed replication.

**Harbour correction, 2026-10-09.** Generated boards for 5 or 6 players previously had six 3:1 harbours and
only one sheep harbour. The distribution now matches source 14. Tests check the complete type counts
against literal rulebook expectations. Old seed links for 5 or 6 players now use the corrected distribution;
custom-board links carry their own harbours and remain unchanged. Base-game boards and scoring weights
are unaffected. The custom-board box check now compares each harbour type as well as the total count,
so a board with nine ore harbours can no longer claim to match the base-game box.

**Scoring policy `r7-owned-ports-2026-10-09`.** A harbour type already available through your own
settlement adds no further trading access (source 15). R7 now excludes that duplicate from both direct
and reachable-port bonuses. A different resource-specific port can still improve a 3:1 rate to 2:1;
a new generic port still helps resources not covered by an existing specific port. A duplicate on the
candidate corner does not hide a useful different port two roads away. The entered coast stays intact,
and the explanation states why a duplicate direct port adds no bonus. All bonus sizes and other weights
are unchanged. Earlier benchmark tables retain their original frozen policy and source hashes.
The separate, predeclared 24,000-game comparison finished on new boards with no outcome-based tuning:
corrected Lens won 1,972/8,000 versus 1,976/8,000 before the correction. The primary paired difference
is −0.05 percentage points (planned approximate 95% t interval: −0.098 to −0.002). Only four win/loss
pairs differ, all favoring the old policy; this narrow interval rests on sparse changes. These results
show no win-rate gain and do not establish equivalence. The correction follows source 15's trading
rules, independently of those outcomes. [Full evidence](../bench/catanatron/results.md#owned-harbour-correction-2026-10-09)
includes exact counts, source hashes and the descriptive comparison against the value bot.

**Harbour reachability correction, 2026-10-09.** The former R7 search found two-road routes only when
their final road followed the harbour edge. A harbour settlement can also be reached from inland:
the trade rate comes from the settlement at either marked endpoint, not the direction of its road
(source 15). R7 now examines every destination exactly two roads away that remains legal after the
candidate settlement. Useful direct access keeps priority; otherwise it takes the best new reachable
port, preserving bonus sizes and the exclusion of types already owned.
A fixed-context audit covered 264,230 corners in 4,800 scenarios. It found 64,343 score changes and
694 changes of the first-ranked corner. All 90,356 useful direct-access scores, every non-port
component, and all 4,800 rankings with harbours ignored stayed identical. Those are deterministic
model samples, not a frequency estimate for human games. Unit cases include inland access to a 3:1
port, a better reachable 2:1 port, blocked destinations, and already-owned types.
The predeclared 24,000-game comparison on fresh boards produced 1,981/8,000 wins with complete
reachability versus 1,980/8,000 before it. The primary paired difference was +0.0125 percentage points
(approximate 95% interval: −0.7705 to +0.7955); 488 pairs changed to a win and 487 to a loss. This does
not establish an advantage or equivalence. Both versions already contain the ownership and rounding
fixes. [Full evidence](../bench/catanatron/results.md#harbour-reachability-correction-2026-10-09)
includes the descriptive comparison with the value bot; outcomes did not tune the policy.

**Comparison correction, 2026-10-09.** When two corners shared the same kinds of bonuses, the old
comparison could fall back to a claim of “same production” even when their raw pips differed. The
comparison now uses the existing numerical score terms to explain the advantage, acknowledges when
the alternative has more raw production, and reports small score gaps to two decimal places. This changes
the explanation, not the rankings or weights. The label describes why the top corner scores higher;
it no longer implies that every difference is something the other corner entirely lacks.

**Grade-display correction, 2026-10-09.** Whole-percent rounding previously displayed some lower-ranked
picks as 100% and promoted scores just below 90% into the Fair grade. Percentages now round down to
hundredths using the scorer's existing hundredth-point units. Exact score ties still share rank 1 and,
when positive, 100%; the grade boundary uses the actual score share. Cards show scores to two decimal places, and
failed drills show their point gap. A miss within 1% of the top score is labelled a close model comparison
(an author-chosen presentation threshold), without changing the drill target or implying a measured
difference in winning chances. Rankings and scoring weights are unchanged.

**Signed-score display, 2026-10-09.** A custom all-brick, number-2 board under C&K weights exposed a
−0.51 pick against a 0.03 best score: the former −1700% label is replaced by its 0.54-point gap.
Percentages are omitted when the pick is negative or the best is nonpositive, retaining the actual
scores and ranks. An audit of 2,400 standard generated second-pick scenarios found no negative scores;
this is a custom-board presentation edge case, not evidence of a common standard-board defect.
Across the corresponding first and second rankings, 264,230 ordinary grades were unchanged.

**Rounding consistency, 2026-10-09.** A separate rotation/reflection audit compared 2,746,726 mapped
corners across 28,000 transformed scenarios. Binary addition order changed 522 scores by 0.01,
including two comparisons that falsely made a second-choice corner tied for best. Half-cent boundaries
now discard only machine-precision noise before the existing rounding rule. The same audit then found
zero score or grade differences. An independent exact-fraction calculation checked 529,186 scores
across standard and custom boards: 3,009 older rounded scores differed from that calculation, and none
of the corrected scores did. No weights changed and no first-ranked choice changed in those 9,600
fixed-input rankings. This verifies arithmetic consistency; it does not establish identical choices
on every board or a change in winning chances. The later harbour-reachability comparison includes
the rounding repair in both versions; it does not isolate a win-rate effect for rounding itself.

## 2026-09-15

**Audit 2026-09-15.** A systematic bug audit confirmed 54 defects (3 high, 14 medium, 37 low); all were fixed
the same day. Scoring-visible ones: R6 no longer charges a duplicate inside your own first settlement to
every second-settlement corner; R7 stopped crediting blocked harbour destinations (the later inland-route
correction above completes its two-road search);
R8 lists every expansion value it scores (parts and the total are rounded separately); R9 starting cards count one
per hex; the scarcity cap moved 1.3 → 1.25 (see R3); the number spiral is now continuous like the official
one; "the most on the board" is measured board-wide; ties share rank 1; the comparison never lists something
the pick already has. The rest were page-state defects (drill re-answer through the projected list, score
leaking before commit, reload losing placement order, hostile links crashing the page, and so on).

**Your board (added 2026-09-15) enters the real board.** Catanalyzer (catanalyzer.vercel.app), a board analyser that
scores corners by roll probability and a fixed resource weight, showed the value of entering the board in front of
you; that idea was borrowed. "Your board" starts from the board
on screen; paint resources, tap a hex then its token, tap coastal edges to cycle harbours. A blank or desert hex
never carries a number and produces nothing. The link carries the board (`b=` one letter per hex plus its number,
`h=` edge:harbour pairs); a check lists differences from the official box; balance is
measured from the entered numbers. Every existing rule then applies unchanged. Nothing in the scoring moved.
