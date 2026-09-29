"""Narration for the demo videos, spoken by Kokoro (open weights, Apache-2.0, runs locally).

  python video/narrate.py --model DIR [id ...]

DIR holds kokoro-v1.0.onnx and voices-v1.0.bin (https://github.com/thewh1teagle/kokoro-onnx/releases).
Writes build/<id>/scene-NN.wav and build/<id>/timings.json: per scene its duration and each sentence's
start/end inside it, which become the captions.
"""
import argparse
import json
import os
import re
import subprocess

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
GAP = 0.28  # seconds of silence between sentences


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    script = json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e",
         "import {VIDEOS} from './video/scenes.mjs'; console.log(JSON.stringify(VIDEOS.map(v => ({id: v.id, says: v.scenes.map(s => s.say)}))))"],
        cwd=os.path.dirname(HERE)))
    k = Kokoro(os.path.join(a.model, "kokoro-v1.0.onnx"), os.path.join(a.model, "voices-v1.0.bin"))
    for v in script:
        if a.ids and v["id"] not in a.ids:
            continue
        out = os.path.join(HERE, "build", v["id"])
        os.makedirs(out, exist_ok=True)
        timings = []
        for i, say in enumerate(v["says"]):
            chunks, sentences, t = [], [], 0.0
            for sent in [x for x in re.split(r"(?<=[.!?])\s+", say.strip()) if x]:
                samples, sr = k.create(sent, voice=a.voice, speed=a.speed, lang="en-us")
                chunks += [samples, np.zeros(int(GAP * sr), dtype=samples.dtype)]
                sentences.append({"start": round(t, 3), "end": round(t + len(samples) / sr, 3), "text": sent})
                t += len(samples) / sr + GAP
            sf.write(os.path.join(out, f"scene-{i:02d}.wav"), np.concatenate(chunks), sr)
            timings.append({"duration": round(t, 3), "sentences": sentences})
        json.dump(timings, open(os.path.join(out, "timings.json"), "w"), indent=1)
        print(f"{v['id']}: {len(timings)} scenes, {sum(x['duration'] for x in timings):.1f} s of narration")


if __name__ == "__main__":
    main()
