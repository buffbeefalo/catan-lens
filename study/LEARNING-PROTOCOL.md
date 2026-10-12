# Study B: usability and learning protocol

> **Status, 12 October 2026: not run.** No participants have been recruited and no sessions have taken place. Recruitment and results are outstanding. This document is a plan; nothing in it is a finding.

Protocol version 2026-10-12, for the positions file `positions-2026-10-12.json`. Record the git commit of this file when the study is registered, and do not change the plan after the first session of a phase starts.

## 1. Questions

1. **Usability.** Can players who know the rules, but are new to Catan Lens, enter a real board, understand a recommendation and compare alternatives without help?
2. **Learning.** After a short practice session with Catan Lens, do players choose opening settlements that an independent expert panel accepts more often than players who spent the same time reading a printed strategy article?

This study does not ask whether Catan Lens's advice is right; that is study A (see `README.md`). Study B depends on study A: test answers are scored against the expert panel from study A, never against Catan Lens itself.

## 2. Design at a glance

- **Two phases.** Phase 1 is a few small usability rounds, where problems found in one round can be fixed before the next. Phase 2 is the learning comparison, run on one fixed version of Catan Lens. Nobody takes part in both phases.
- **Two groups, same time (phase 2).** Each participant is assigned at random to one of two groups:
  - **Lens:** 30 minutes with Catan Lens: the usability tasks T1 to T4, then practice in Drill mode.
  - **Reading:** 30 minutes with a printed strategy article on opening placement.

  Both groups spend the same time, take the same tests and hear the same instructions. Getting used to the test (familiarity) helps both groups equally, so it is not mistaken for learning: only a gain beyond the Reading group's counts for Catan Lens.
- **Different positions before and after.** The pre-test and the post-test use different held-out positions: forms A and B of the positions file, 8 positions each, with every seat once for each task. Half of each group takes A first, half B first. Form C is kept for an optional retention test 1 to 2 weeks later.
- **Held-out positions.** Test positions never appear during practice. They come from seeds reserved for the studies (9,000,000 to 9,000,999), while the app's random and Drill boards draw seeds from about 4.3 billion values, so a practice board matching a test board is very unlikely.
- **Independent scoring.** A test answer counts as good when the expert panel from study A accepted that corner. Catan Lens trained the Lens group, so agreeing with Catan Lens would reward copying it; that match is reported only as a description, never as the outcome.

## 3. Participants

- **Who:** adults (18 or over) who know the basic rules of Catan and have finished at least one game.
- **Not eligible:** study A reviewers (they have seen the test positions); anyone who has used Catan Lens before (ask when they sign up and record the answer); phase 1 participants, for phase 2.
- **Recorded about each person,** against their code only: games played (1 to 5, 6 to 20, 21 to 100, more than 100), self-rated skill from 1 to 5, and whether they have used Catan Lens before.
- **Recruitment:** outstanding. Possible routes are local board game groups, university clubs and online Catan communities. Use the same invitation text for everyone, and do not mention which group is expected to do better.
- **How many:** see section 12.

## 4. Consent, anonymity and withdrawal

- **Ethics review.** If the study runs through a university or the results will be published, get approval from the relevant ethics board before recruiting. This protocol is not an approval.
- **Information sheet,** in plain words, covering: what the study is for; what happens and how long it takes (about 70 minutes); that taking part is voluntary; what is recorded; where data are kept and for how long; how to withdraw; and who to contact.
- **Consent** is recorded before anything else, on paper or a separate form that is stored apart from the study data. A suggested statement: "I have read the information sheet. I understand that taking part is voluntary, that I can stop at any time without giving a reason, and that my answers are stored under a code, not my name. I agree to take part."
- **Codes, not names.** Each participant gets a code from the allocation list (for example B01, B02). The code is the only identifier in any study file, and the review page asks only for it. Names, email addresses and other contact details never go into study files. If contact details are needed (for a retention test or a thank-you), keep them in a separate list, never in the repository, and destroy it when the study ends.
- **No recordings** of screen, voice or face unless the participant agrees to that separately. The facilitator's notes contain no names.
- **Withdrawal.** Participants can stop at any time without giving a reason. Their data are deleted on request until a cut-off date set before recruitment and printed on the information sheet; after that, results exist only in aggregate.
- **Storage.** Answer files and notes stay out of git: outside the repository, or in `study/responses/`, which `.gitignore` excludes. Keep them on an encrypted drive for a retention period set before recruitment.
- **Fairness.** Any thank-you gift is the same for both groups and does not depend on test scores. At the end, offer the Reading group a link to Catan Lens and the Lens group a copy of the article.

## 5. Materials and set-up

- **A laptop** with Firefox, to open `study/review.html` straight from the disk. In another browser, use the local preview described in `README.md`.
- **Catan Lens at a fixed version.** Record the release or commit used. At this commit the app shows the classic ranking only; the look-ahead policy is not in the app. Run it locally (`npm start`) or from the public site, but use the same version for every session of a phase.
- **A physical Catan set** (base game), laid out before each session for task T1. Take the layout from a seed outside the reserved range, for example by opening Catan Lens with `?seed=12345` at the end of its address, and keep a printed copy of the layout to check against. Record the seed.
- **The printed article** for the Reading group, chosen before recruitment (see section 13). Record its title, author, date and page count.
- **Session sheets:** copies of the templates in `study/templates/`.
- **A timer.**

## 6. Allocation (phase 2)

- Before recruitment, make the allocation list in blocks of four. Each block holds the four combinations Lens with A first, Lens with B first, Reading with A first and Reading with B first, in a random order. Record how the order was randomised (for example the tool and seed used).
- Give the places codes B01, B02 and so on, in list order, and assign each new participant the next unused place.
- Keep the list where the facilitator sees only the next entry, for example in sealed envelopes or held by a second person.
- Record every place used, including people who stop early, in `learning-participants.csv`.

## 7. Session script (phase 2, about 70 minutes)

Book 90-minute slots. Read the quoted lines word for word, so both groups hear the same thing.

| Step | Minutes | Lens group | Reading group |
|---|---|---|---|
| 1. Welcome, information sheet, consent | 5 | same | same |
| 2. Background questions | 2 | same | same |
| 3. Pre-test (first form) | 10 | same | same |
| 4. Practice | 30 | Tasks T1 to T4, then Drill mode | Read the article |
| 5. Break | 5 | same | same |
| 6. Post-test (second form) | 10 | same | same |
| 7. Questionnaire | 5 | Usability questions and two learning questions | Two learning questions |
| 8. Debrief | 3 | same | same |

**Step 3 and step 6, tests.** "This page shows 8 Catan positions, one at a time. For each one, pick the corner you would actually play, and say how sure you are. Work on your own: no notes, no apps and no help. There are no hints and no score. Take about a minute for each position." Section 9 gives the details.

**Step 4, Lens group.** Run the usability tasks in section 8, then say: "For the rest of the practice time, please use Drill mode. Play as many levels as you like until I say stop."

**Step 4, Reading group.** "Please read this article about where to place your first settlements. You can make notes. You have 30 minutes; if you finish early, go back over the parts you found most useful." Collect the article and any notes before step 6.

**Step 8, debrief.** Explain the two groups and what the study compares, answer questions, and offer the other group's material. Ask participants not to discuss the test positions with anyone.

Phase 1 sessions (usability rounds) use steps 1, 2, 4 (Lens tasks T1 to T3 only), 7 and 8, and take about 30 minutes.

## 8. Usability tasks (Lens group, and phase 1)

Read each task aloud, then watch without helping. If the participant is stuck for 2 minutes or asks for help, give one hint, note it, and mark the task as done with help. Record each attempt in `learning-tasks.csv`.

| Task | Time limit | Read aloud | Counts as done when |
|---|---|---|---|
| T1. Enter a real board | 10 minutes | "Here is a Catan board on the table. Please set up the same board in Catan Lens." | Every tile, number and harbour in the app matches the table, checked against the printed layout. |
| T2. Understand a recommendation | 3 minutes | "You are seat 1 and nobody has placed yet. Which corner does Catan Lens suggest for your first settlement, and why? Tell me in your own words." | They name the suggested corner and give at least two of the reasons the app shows for it, in their own words. |
| T3. Compare alternatives | 4 minutes | "Pick another corner you like. How does it compare with the suggested one?" | They open that corner's grade and explanation and name at least one real difference, for example in production, resource mix or harbour. |
| T4. Practice | Rest of the 30 minutes | "Now practise in Drill mode until I say stop." | Not a pass or fail task: record the highest level reached. |

Columns of `learning-tasks.csv`: `task` is T1 to T4; `outcome` is `done`, `done_with_help` or `not_done`; `seconds` is the time taken; `hints` is the number of hints given; `errors_seen` is a short count or description of slips (for example a wrong number entered and corrected); `drill_level_reached` is for T4 only.

## 9. The unaided tests

- Use the review page in test mode: open `study/review.html?form=A` (or `B` or `C`) in Firefox, or `http://127.0.0.1:8000/study/review.html?form=A` with the local preview.
- **Before each participant:** check the page shows no earlier answers (press **Clear answers on this device** if it does), and type the participant's code into the code box.
- The page shows only that form's 8 positions, one at a time, and asks only for a corner and how sure the participant is: no alternatives, no plans, no hints and no scores.
- **After the test:** press **Download my answers**. The file is named like `catan-test-form-A-B01-2026-11-03.json` and is marked `"study": "learning-test"` and `"form": "A"`. Save it in the session folder, then clear the answers before the next participant. Each form keeps its own answers in the browser, so clear every form a participant used.
- The facilitator does not comment on any choice, during or after the test.
- Nobody may use Catan Lens, notes or the article during a test.

## 10. Scoring

1. **Reference answers.** Use the panel sets from study A: every corner accepted by at least half of a position's expert reviewers. Freeze them before scoring any study B answer. `node study/analyze.mjs --json panel.json <study A answer files>` writes them under `results.byPosition`, field `panel`, as corner numbers.
2. **Each answer** scores 1 if its corner is in the panel set for that position, otherwise 0.
3. **Empty panel sets.** A position with an empty panel set is left out for everyone. Report how many were left out.
4. **Test score** is the number of positions answered with a panel set corner, from 0 to 8 (fewer if positions are left out). The **gain** is the post-test score minus the pre-test score.
5. **Match with Catan Lens.** Also record whether each answer matches Catan Lens's top choice, but only to describe what the Lens group picked up. It is not an outcome.
6. **Scoring script: outstanding.** None exists yet. Before the first phase 2 session, write one, test it on made-up files, and do not change it after seeing real data. Test answer files have the same format as review files (`templates/answers.schema.json`), and `templates/learning-test-answers.csv` can hold the scored answers, one row per answer: `test` is `pre`, `post` or `retention`; `in_panel_set` is 1, 0, or empty when the position is left out.

## 11. Analysis plan

- **Primary outcome:** the difference in mean gain between the Lens and Reading groups, with a 95% confidence interval (Welch's t interval). A positive difference means the Lens group improved more.
- **Also report:** each group's mean pre-test and post-test scores; results by form order (A first or B first), since the forms may differ in difficulty; and how many people stopped before the post-test, by group. Analyse everyone who took both tests in the group they were assigned to.
- **Secondary:** change in confidence; the share of post-test answers matching Catan Lens's top choice (description only); results by experience band; the retention test, if run.
- **Usability:** for each task, the share done without help, done with help and not done; the median time; the usability score below (Lens group); and a list of problems seen, ordered by how often they came up.
- **Register first.** Before the first phase 2 session, register this plan with the commit of this file, for example on OSF.

### Questionnaire (step 7)

Usability questions, Lens group only: the standard System Usability Scale (Brooke, 1996), each answered from 1 (strongly disagree) to 5 (strongly agree):

1. I think that I would like to use Catan Lens frequently.
2. I found Catan Lens unnecessarily complex.
3. I thought Catan Lens was easy to use.
4. I think that I would need the support of a technical person to be able to use Catan Lens.
5. I found the various functions in Catan Lens were well integrated.
6. I thought there was too much inconsistency in Catan Lens.
7. I would imagine that most people would learn to use Catan Lens very quickly.
8. I found Catan Lens very cumbersome to use.
9. I felt very confident using Catan Lens.
10. I needed to learn a lot of things before I could get going with Catan Lens.

Score: for odd items take the answer minus 1, for even items take 5 minus the answer, add the ten results and multiply by 2.5, giving 0 to 100.

Learning questions, both groups:

- "How much do you feel you learned about choosing opening settlements today?" 1 (nothing) to 5 (a lot).
- "In a sentence or two, what did you learn?"

Record the answers in `learning-questionnaire.csv` (`sus_1` to `sus_10`, `sus_score`, `perceived_learning_1_to_5`, `what_you_learned`).

## 12. Sample size (planning assumptions, not results)

- **Learning comparison.** Assume the gain (0 to 8 scale) has a standard deviation of 1.5 points in both groups, and that a difference of 1 point between groups is worth detecting (a standardised effect of 0.67). A two-sided test at the 5% level with 80% power then needs 37 participants per group: the normal approximation gives 35.3, and the usual small-sample correction adds about one (a simulation of the t test gave 80.5% power with 37 per group and 79.9% with 36). Allowing for 10% dropout, recruit 42 per group, 84 in total.
- **Check the assumption.** No pilot data exist. Run a pilot of 6 to 10 people (not part of the main analysis) to estimate the spread. If the spread is 2 points, or the difference worth detecting is 0.75 points, about 64 per group are needed.
- **Usability rounds.** 5 to 8 people per round, which usually shows the most common problems. Fix them, then run another round, until a round shows no serious problem.
- **Expert panel.** Study A needs at least 5 reviewers, and must finish before study B scoring starts.

## 13. Limitations

- One short session measures short-term learning only; the form C retention test is the only check on whether it lasts.
- With 8 positions per test the score is coarse, and positions left out for empty panel sets make it coarser.
- The panel sets come from a small expert panel and share its blind spots. Agreement with experts is one source of evidence, not proof that a choice is best.
- Better opening choices may not mean winning more games; this study does not measure play.
- The facilitator knows each participant's group. Reading the script word for word and scoring by computer limits this bias but does not remove it.
- Volunteers may be keener or stronger than typical players, and the Lens group may guess what the study hopes to find.
- The result depends on the article chosen: a weak article flatters Catan Lens. Choose a widely used, well regarded article before recruitment, ideally with advice from the study A panel, and record it.
- Forms A and B may differ in difficulty. Counterbalancing spreads this over both groups but adds noise.
- In the test positions and in Drill mode alike, the pieces already placed follow the classic projection, so the Lens group may find the test positions more familiar than the Reading group does.
- Experience and skill are self-reported.
