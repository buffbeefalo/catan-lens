"""Acceptance checks for the finished videos in out/. Exits non-zero if any fails.

  python video/qa.py [--ffmpeg PATH] [--asr MODEL] [id ...]

What they establish: format and loudness, that a speech recogniser hearing the finished file with no hint of the
script gets the words right, that each line starts where its scene does, that the encode keeps the picture (SSIM
against losslessly drawn frames, including close-ups of text being read), and that captions are short, ordered and
inside the video. What they cannot establish: whether the voice sounds natural or the whole feels professional;
that still needs a person watching.
"""
import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from narrate import errors, words  # noqa: E402
import render  # noqa: E402


def sh(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--asr", default="medium.en")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    ffprobe = os.path.join(os.path.dirname(a.ffmpeg), "ffprobe") if os.path.dirname(a.ffmpeg) else "ffprobe"
    from faster_whisper import WhisperModel
    asr = WhisperModel(a.asr, device="cpu", compute_type="int8", cpu_threads=12)
    failed = 0
    for vid in sorted(f[:-4] for f in os.listdir(os.path.join(HERE, "out")) if f.endswith(".mp4")):
        if a.ids and vid not in a.ids:
            continue
        mp4, d = os.path.join(HERE, "out", vid + ".mp4"), os.path.join(HERE, "build", vid)
        tl = json.load(open(os.path.join(d, "timeline.json")))
        nar = json.load(open(os.path.join(d, "narration.json")))
        res = []

        def gate(name, ok, detail):
            res.append((name, ok, detail))

        # format
        info = json.loads(sh(ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", mp4).stdout)
        v = next(s for s in info["streams"] if s["codec_type"] == "video")
        au = next(s for s in info["streams"] if s["codec_type"] == "audio")
        gate("format", (v["width"], v["height"], v["r_frame_rate"], v["pix_fmt"], au["codec_name"], au["sample_rate"], au["channels"])
             == (1920, 1080, "60/1", "yuv420p", "aac", "48000", 2), f"{v['width']}x{v['height']} {v['r_frame_rate']} {v['profile']} {v['pix_fmt']}, {au['codec_name']} {au['sample_rate']} Hz x{au['channels']}")
        head = open(mp4, "rb").read(200000)
        gate("fast start", head.find(b"moov") != -1 and (head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat")), "index before media, so playback starts before the download ends")
        # loudness
        err = subprocess.run([a.ffmpeg, "-hide_banner", "-nostats", "-i", mp4, "-af", "loudnorm=print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
        L = json.loads(err[err.rindex("{"):err.rindex("}") + 1])
        gate("loudness", -16.5 <= float(L["input_i"]) <= -15.5 and float(L["input_tp"]) <= -1.0, f"{L['input_i']} LUFS integrated, {L['input_tp']} dBTP true peak, LRA {L['input_lra']}")
        # words, heard from the finished file with no prompt
        wav = os.path.join(d, "qa.wav")
        subprocess.run([a.ffmpeg, "-v", "error", "-y", "-i", mp4, "-ac", "1", "-ar", "16000", wav], check=True)
        x, _ = sf.read(wav, dtype="float32")
        # heard line by line from the finished file (long-form decoding loses its place), with no hint of the script
        spans = [(s["voice"], n) for s, n in zip(tl["scenes"], nar["scenes"])] + [(tl["outro"]["voice"], nar["outro"])]
        e = total = 0
        for at, line in spans:
            seg = x[int(max(0, at - 0.3) * 16000):int((at + line["duration"] + 0.3) * 16000)]
            segs, _ = asr.transcribe(seg, language="en", beam_size=5, condition_on_previous_text=False)
            heard, ref = " ".join(s.text for s in segs), words(line["text"])
            k = errors(ref, words(heard))
            e, total = e + k, total + len(ref)
            if k:
                print(f"  {vid} at {at:.1f}s heard: {heard.strip()}\n  {' ' * len(vid)}   script: {line['text']}")
        gate("words", e / total <= 0.02, f"{e} word errors in {total} ({100 * e / total:.1f}%), each line heard on its own, recogniser given no script")
        # each line starts where its scene says: speech energy rises within 0.2 s of the planned start
        env = np.sqrt(np.convolve(x ** 2, np.ones(320) / 320, "same"))
        late = []
        for at in [s["voice"] for s in tl["scenes"]] + [tl["outro"]["voice"]]:
            i0, i1 = int((at - 0.3) * 16000), int((at + 0.4) * 16000)
            on = np.flatnonzero(env[i0:i1] > 0.02)
            if not len(on) or abs(i0 / 16000 + on[0] / 16000 - at) > 0.2:
                late.append(f"{at:.2f}")
        gate("sync", not late, f"{len(tl['scenes']) + 1} lines start on cue" if not late else f"lines off cue at {late}")
        # picture: encoded frames against losslessly drawn ones, whole frame and the text being read
        p = render.Painter(d)
        times = [k["t"] + render.CAM_TIME + 0.4 for k in tl["camera"] if k["font"]] + [tl["duration"] * f for f in (0.1, 0.35, 0.6, 0.9)]
        worst, worst_read = 1.0, 1.0
        for t in times:
            n = round(t * render.FPS)
            ref_png = os.path.join(d, "qa-ref.png")
            p.frame(n).save(ref_png)
            # compare in the encoded colour space: the reference goes through the encoder's own RGB -> YUV conversion
            out = subprocess.run([a.ffmpeg, "-hide_banner", "-i", mp4, "-i", ref_png, "-lavfi",
                                  f"[0:v]select=eq(n\\,{n}),setpts=PTS-STARTPTS[a];[1:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[b];[a][b]ssim",
                                  "-frames:v", "1", "-f", "null", "-"], capture_output=True, text=True).stderr
            y = float(re.search(r"Y:([\d.]+)", out).group(1))
            if t in times[:-4]:
                worst_read = min(worst_read, y)
            worst = min(worst, y)
        gate("picture", worst >= 0.97 and worst_read >= 0.97, f"worst SSIM (Y) {worst:.4f} over {len(times)} frames; text close-ups {worst_read:.4f}")
        # captions
        vtt = open(os.path.join(HERE, "out", vid + ".vtt")).read().strip().split("\n\n")[1:]
        bad, last = [], 0.0
        for c in vtt:
            ts, *text = c.split("\n")
            a0, a1 = [sum(float(p) * 60 ** i for i, p in enumerate(reversed(x.split(":")))) for x in ts.split(" --> ")]
            if len(text) > 2 or max(len(t) for t in text) > 42 or a1 - a0 > 7 or a0 < last - 1e-3 or a1 > tl["duration"]:
                bad.append(ts)
            last = a1
        gate("captions", not bad, f"{len(vtt)} cues, all ≤ 2 lines of ≤ 42 characters, ≤ 7 s, in order" if not bad else f"bad cues {bad[:3]}")
        for f in ("qa.wav", "qa-ref.png"):
            os.remove(os.path.join(d, f))
        print(f"\n{vid} ({tl['duration']:.1f} s)")
        for name, ok, detail in res:
            print(f"  {'PASS' if ok else 'FAIL'}  {name:10s} {detail}")
            failed += not ok
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
