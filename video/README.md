# Demo videos

The two videos on the How it works page are built from the real app, so they can be regenerated after any change.
Narration and on-screen actions live together in `scenes.mjs`; the corners the videos click are computed with the
app's own scoring code. Key actions follow cues from the recognised narration timings. Timeline and finished-file
checks verify framing, narration starts, captions and picture quality; review the demonstrated flow as well.

Nothing is screen-recorded. `record.cjs` drives the app in a browser and saves a 4x screenshot at every step, with
the cursor path, clicks and camera framings written to a timeline. `render.py` then draws every 60 fps frame from
that timeline: the app window on a backdrop, a camera that eases between framings, a cursor that glides along the
recorded path, chapter labels, and the title, results and end cards from `cards.html`. There is no music on
purpose: nothing in the pipeline can judge music, so the videos carry the voice alone.

Each captured state also records the page's URL query, preserving the exact board, settings and placements
without its local server address. Use it to reproduce a scene during a later policy or footage review.

Pipeline (from the repository root; needs Node 22, ffmpeg with libx264, and a CUDA GPU for the voice):

```sh
# 0. Python tools: install torch and torchaudio for your platform (https://pytorch.org), then
python -m venv video/.venv && video/.venv/bin/pip install -r video/requirements.txt

# 1. Narration: Chatterbox speaks each line four times in its built-in voice (more, up to 16, if none passes);
#    faster-whisper transcribes every take, a phonetic transcriber checks that each "Catan" is said cuh-TAHN, and
#    the take that matches the script word for word, at the most typical length, is kept (build/<id>/narration.json).
video/.venv/bin/python video/narrate.py            # --model DIR and --asr DIR accept local model copies

# 2. Cards and recording: the designed frames, then the app itself (npm start serves it locally).
npm start &
node video/cards.cjs
node video/record.cjs

# 3. Picture: checks the timeline (every click lands on its target, nothing pointed at leaves the frame, text
#    being read is at least 28 px tall, no zoom past what the capture keeps sharp), then draws and encodes.
video/.venv/bin/python video/render.py --ffmpeg ffmpeg

# 4. Sound, captions and final files: the voice is cleaned (low cut, de-esser, light compression) and mastered
#    to -16 LUFS, captions are timed to the spoken words; writes video/out/<id>.mp4, .vtt, .txt and .jpg.
video/.venv/bin/python video/assemble.py --ffmpeg ffmpeg

# 5. Acceptance: format, loudness, every line heard word for word by a recogniser given no script, every "Catan"
#    heard as cuh-TAHN, lines on cue, picture fidelity against losslessly drawn frames, caption lengths. Exits
#    non-zero on any failure.
video/.venv/bin/python video/qa.py --ffmpeg ffmpeg

# 6. README images (docs/media/), drawn from the same frames.
video/.venv/bin/python video/readme_media.py
```

Refreshing the pictures only (the app's screens changed, the narration did not): keep the cached narration,
then run steps 2 to 6, which re-record, re-render, re-check and redraw the README images. Before publishing, read
each transcript (`video/out/<id>.txt`) against the new pictures; reuse a line that is still accurate, and if a
picture now contradicts one, re-voice only that line (`narrate.py --resume`). The recorder stops if a scripted
corner click would land on anything but the corner (road slots sit on the board after Keep), if any scripted
click lays a road, or if Keep does not add exactly one settlement that stays on screen. Then require all eight
acceptance checks and watch both videos and look at every README image yourself. The videos and images are
binary files made by this local pipeline; record the actual results below and leave any unfinished media work
visibly pending rather than describing it as done.

`video/out/*.vtt`, `*.txt` and `*.jpg` go into `public/media/`. The MP4s are attached to a GitHub Release; the Pages
workflow copies them into the published site, so they never enter git history.
For local playback checks, also copy the MP4s into `public/media/`. The local server supports seeking;
check playback, forward/backward seeking and enabled captions in a browser with H.264/AAC support.
If a browser build lacks those codecs, verify the transcript fallback instead of calling playback a pass.

What the checks cannot tell you: whether the voice sounds natural and the whole feels right. Watch the result.

The walkthrough includes the combined opening's resource income, starting hand and separate build costs,
the explicit harbour choice for custom boards, and the fresh-seed benchmark with its limits. The results card
reads the `holdout` section of the published results and stops if it is missing. Opening facts distinguish
expected cards from the chance of any income; the Cities & Knights switch is described as weighting only.
The recorder supports explicit scrolling for content below the fold and still rejects unplanned scrolling.
Run the timeline check after recording to catch cropped content before spending time on the full render.
README feature images follow named camera targets and chapters in that timeline, so changed narration
lengths cannot silently select a different feature at an old timestamp. They wait for screen transitions
to finish, avoiding double text in a still image taken during a cross-fade.
The draft passage frames the actual road explanation, including the projection behind a skipped target.
Readability checks measure text on the camera target itself as well as its children.

For fully local narration and checking, pass existing model directories with `--model` and `--asr`, and set
`HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1`. A cached snapshot can be passed directly even if its model-name
lookup is unavailable offline. The acceptance checker also takes `--asr DIR`. All video generation uses
local models; the application itself makes no model or account requests.
Use `--resume` after repairing a script line to retain matching, previously approved takes. A line with no
passing take gets more takes, up to sixteen; if none passes, it is recorded for inspection and makes
narration exit unsuccessfully; assembly also refuses unchecked narration. The recorder normalises
British/American spellings like harbour/harbor consistently with the speech checker when matching a camera
cue to spoken words.

The 2026-10-09 refresh is 71.3 seconds for the overview and 195.2 seconds for the walkthrough, both
1080p at 60 fps. Finished-file checks passed format, streaming index, loudness, narration timing,
picture fidelity and all 21/52 caption cues. The recogniser matched 173/173 overview words and
472/472 walkthrough words. The revised draft passage describes the model's opening choices and
explains that a road destination is not guaranteed to remain available. These checks do not establish
natural-sounding speech or playback on every device.

A follow-up overview refresh replaces the older road-conflict wording visible in its captured app
screens. The narration, captions, transcript and poster are byte-for-byte unchanged; the finished
movie again passed all seven acceptance checks, including 173/173 recognised words and 21 caption
cues. The walkthrough remains byte-for-byte unchanged from the preceding refresh. The signed-score
display and repeated-number wording were reviewed against both demonstrations: these examples use
positive scores, and no old discard-frequency claim appears in the reviewed explanation scenes.

The subsequent half-cent rounding repair was checked against the recorded Explore, Drill and custom
board examples. Their displayed picks, grades, road advice and projected placements are unchanged,
although some unshown lower-ranked scores move by a hundredth. The help page and benchmark records
identify the game tests as preceding this arithmetic correction; the videos retain their dated results.

The later owned-harbour correction was reviewed against these demonstrations: the seed-42 first/second
choices, second ranking and both suggested roads are unchanged. The results card remains the dated
fresh-seed test of its recorded policy; the help page identifies later policy changes separately.

The 2026-10-12 refresh replaces the narrator. A phonetic transcriber heard none of the previous voice's
five published "Catan"s as cuh-TAHN (the vowel of "cat" four times, of "bet" once), so narration now uses
Chatterbox's built-in voice with its default settings, and both the take selection and the finished-file
check require every "Catan" to be heard as cuh-TAHN. Run on the previous overview, the new check failed
only on the name (0 of 3) while every earlier check still passed. The recogniser now hears each take after
0.3 seconds of silence, as in the finished-file check; without it, it sometimes missed a line's first
word. The new videos are 59.2 seconds and 157.9 seconds, both 1080p at 60 fps. All eight acceptance checks
passed, including 173/173 and 472/472 recognised words, 3/3 and 2/2 names heard as cuh-TAHN, and all 21/52
caption cues. The new voice is faster, about 215 words a minute against about 170 before. Lowering
Chatterbox's `cfg_weight` or `exaggeration` slowed it by at most about 7 percent and passed fewer test
takes (4 to 7 of 12, against 9 of 12), so the defaults stay. Because the overview's opening-summary scene
is now shorter, it frames the first-builds row on "first builds" and the income section on "Income is an
average", giving each camera move time to arrive. These checks still do not establish natural-sounding
speech.

A second 2026-10-12 refresh updates only the pictures for starting-road placement. After each Keep, the free
sides of a kept settlement now show as dashed road slots, and the card invites you to place your starting
road. A kept settlement's suggested road is now worked out as of its own turn, so in the overview the first
settlement's road no longer switches sides when the second settlement is kept. No scene places a road, and
the narration, captions, transcripts and posters are byte-for-byte unchanged. The narration was reviewed
against the new pictures and still describes them accurately. Both videos stay 59.2 and 157.9 seconds and
again passed all eight acceptance checks, including 173/173 and 472/472 recognised words, 3/3 and 2/2 names
heard as cuh-TAHN, and all 21/52 caption cues. Of the README images, only the Drill still changed: Drill
deals a fresh random board on every recording.
