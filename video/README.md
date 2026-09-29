# Demo videos

The two videos on the How it works page are recorded from the real app, so they can be regenerated after any
change. Narration and on-screen actions live together in `scenes.mjs`; the corners the videos click are computed
with the app's own scoring code, so the videos cannot drift from what the app recommends.

Pipeline (from the repository root):

```sh
# 1. Narration: Kokoro (open weights, Apache-2.0) runs locally.
python -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile numpy
#    download kokoro-v1.0.onnx and voices-v1.0.bin from
#    https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0) into MODEL_DIR
.venv/bin/python video/narrate.py --model MODEL_DIR

# 2. Recording: Playwright drives the app and holds each scene for its narration.
npm start &                 # the local server
node video/record.cjs

# 3. Assembly: ffmpeg (with libx264) muxes picture and voice, writes WebVTT captions,
#    a transcript and a poster frame into video/out/.
.venv/bin/python video/assemble.py --ffmpeg ffmpeg
```

`video/out/*.vtt`, `*.txt` and `*.jpg` go into `public/media/`. The MP4s are attached to a GitHub Release; the Pages
workflow copies them into the published site, so they never enter git history.
