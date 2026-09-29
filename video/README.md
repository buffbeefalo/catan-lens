# Demo videos

The two videos on the How it works page are built from the real app, so they can be regenerated after any change.
Narration and on-screen actions live together in `scenes.mjs`; the corners the videos click are computed with the
app's own scoring code, and each action waits for the words that describe it, so the picture cannot drift from what
the app recommends or from what the narrator is saying.

Nothing is screen-recorded. `record.cjs` drives the app in a browser and saves a 4x screenshot at every step, with
the cursor path, clicks and camera framings written to a timeline. `render.py` then draws every 60 fps frame from
that timeline: the app window on a backdrop, a camera that eases between framings, a cursor that glides along the
recorded path, chapter labels, and the title, results and end cards from `cards.html`. There is no music on
purpose: nothing in the pipeline can judge music, so the videos carry the voice alone.

Pipeline (from the repository root; needs Node 22, ffmpeg with libx264, and a CUDA GPU for the voice):

```sh
# 0. Python tools: install torch and torchaudio for your platform (https://pytorch.org), then
python -m venv video/.venv && video/.venv/bin/pip install -r video/requirements.txt

# 1. Narration: Qwen3-TTS speaks each line four times; faster-whisper transcribes every take and the one that
#    matches the script word for word, at the most typical length, is kept (build/<id>/narration.json).
video/.venv/bin/python video/narrate.py            # --model DIR for a local copy of the model

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

# 5. Acceptance: format, loudness, every line heard word for word by a recogniser given no script, lines on
#    cue, picture fidelity against losslessly drawn frames, caption lengths. Exits non-zero on any failure.
video/.venv/bin/python video/qa.py --ffmpeg ffmpeg

# 6. README images (docs/media/), drawn from the same frames.
video/.venv/bin/python video/readme_media.py
```

`video/out/*.vtt`, `*.txt` and `*.jpg` go into `public/media/`. The MP4s are attached to a GitHub Release; the Pages
workflow copies them into the published site, so they never enter git history.

What the checks cannot tell you: whether the voice sounds natural and the whole feels right. Watch the result.
