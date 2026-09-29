"""Turn each recording into a published video: build/<id>/raw.webm + narration -> out/<id>.mp4, .vtt,
.jpg (poster) and .txt (transcript).

  python video/assemble.py [--ffmpeg PATH] [id ...]
"""
import argparse
import json
import os
import subprocess

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
LEAD = 0.4   # seconds of picture kept before the first scene
TAIL = 0.6   # and after the last


def stamp(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    out = os.path.join(HERE, "out")
    os.makedirs(out, exist_ok=True)
    for vid in sorted(os.listdir(os.path.join(HERE, "build"))):
        if a.ids and vid not in a.ids:
            continue
        d = os.path.join(HERE, "build", vid)
        cues = json.load(open(os.path.join(d, "cues.json")))
        timings = json.load(open(os.path.join(d, "timings.json")))
        start = max(0.0, cues[0] - LEAD)
        length = cues[-1] - start + TAIL
        sr = sf.info(os.path.join(d, "scene-00.wav")).samplerate
        track = np.zeros(int(length * sr) + sr, dtype=np.float32)
        vtt, words = ["WEBVTT", ""], []
        for i, t in enumerate(timings):
            at = cues[i] - start
            clip, _ = sf.read(os.path.join(d, f"scene-{i:02d}.wav"), dtype="float32")
            track[int(at * sr): int(at * sr) + len(clip)] += clip
            for s in t["sentences"]:
                vtt += [f"{stamp(at + s['start'])} --> {stamp(at + s['end'])}", s["text"], ""]
                words.append(s["text"])
        wav = os.path.join(d, "narration.wav")
        sf.write(wav, np.clip(track, -1, 1), sr)
        open(os.path.join(out, f"{vid}.vtt"), "w").write("\n".join(vtt))
        open(os.path.join(out, f"{vid}.txt"), "w").write(" ".join(words) + "\n")
        mp4 = os.path.join(out, f"{vid}.mp4")
        subprocess.run([a.ffmpeg, "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", os.path.join(d, "raw.webm"),
                        "-i", wav, "-t", f"{length:.3f}", "-map", "0:v", "-map", "1:a",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "25",
                        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mp4], check=True)
        subprocess.run([a.ffmpeg, "-loglevel", "error", "-y", "-ss", f"{min(3.0, length / 2):.2f}", "-i", mp4,
                        "-frames:v", "1", "-q:v", "3", os.path.join(out, f"{vid}.jpg")], check=True)
        print(f"{vid}: {length:.1f} s, {os.path.getsize(mp4) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
