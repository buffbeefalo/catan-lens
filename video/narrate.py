"""Narration for the demo videos: Qwen3-TTS (open weights, Apache-2.0) speaks every line several times, faster-whisper
transcribes each take, and the take that says the script word for word at the most natural pace is kept.

  python video/narrate.py [--model DIR] [id ...]

--model is a local copy of Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice (default: download it from Hugging Face).
Writes build/<id>/voice/*.wav (24-bit, trimmed, untreated: mix.py does the processing) and build/<id>/narration.json:
per scene its file, duration and each sentence's start/end (from the word timings), which become the captions,
plus a take report so a bad line is visible without listening.
"""
import argparse
import json
import os
import re
import subprocess

import numpy as np
import soundfile as sf
import torch
import torchaudio

HERE = os.path.dirname(os.path.abspath(__file__))
SPEAKER = "aiden"
STYLE = ("A warm, confident, friendly narrator for a polished product video. Clear American English, relaxed and "
         "measured pace, natural intonation with gentle emphasis on key words, a slight smile in the voice. "
         "Studio-quality voiceover, close microphone, no background noise.")
TAKES = 4
MAX_ERRORS = 0          # a take must match the script word for word (after normalising spelling and numbers)
GAP_LIMIT = 0.9         # and never pause longer than this inside a line

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
SPELLING = {"practise": "practice", "harbour": "harbor", "harbours": "harbors", "&": "and"}


def say_number(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + say_number(n % 100))
    return say_number(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + say_number(n % 1000))


def words(text):
    text = re.sub(r"(\d),(\d)", r"\1\2", text.lower().replace("’", "'"))
    text = re.sub(r"\d+", lambda m: " " + say_number(int(m.group())) + " ", text)
    out = []
    for w in re.findall(r"[a-z']+|&", text.replace("-", " ")):
        w = SPELLING.get(w.strip("'"), w.strip("'"))
        out += w.split()
    return out


def errors(ref, hyp):
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
    return d[-1]


def script():
    return json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e",
         "import {VIDEOS} from './video/scenes.mjs'; console.log(JSON.stringify(VIDEOS.map(v => ({id: v.id, lines: [...v.scenes.map(s => s.say), v.outro.say]}))))"],
        cwd=os.path.dirname(HERE)))


def trim(x, sr):
    on = np.flatnonzero(np.abs(x) > 0.004)
    a, b = max(0, on[0] - int(0.03 * sr)), min(len(x), on[-1] + int(0.15 * sr))
    return x[a:b]


def merge_numbers(ws):
    """The recogniser sometimes splits "40,000" into "40" and ",000"; put such pieces back together."""
    out = []
    for w in ws:
        if out and re.fullmatch(r"\s*,\d{3}\S*", w["w"]) and re.search(r"\d$", out[-1]["w"]):
            out[-1] = {**out[-1], "w": out[-1]["w"] + w["w"].strip(), "end": w["end"]}
        else:
            out.append(w)
    return out


def longest_gap(ws):
    return max([b["start"] - a["end"] for a, b in zip(ws, ws[1:])] or [0.0])


def sentence_times(text, ws):
    """Maps each script sentence onto the transcribed words by word count (the kept take matches the script)."""
    ws = [w for w in ws for _ in words(w["w"])]   # "36" or "thirty-six" is two script words: count it twice
    out, k = [], 0
    for sent in [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]:
        n = len(words(sent))
        a, b = min(k, len(ws) - 1), min(k + n, len(ws)) - 1
        out.append({"start": round(ws[a]["start"], 3), "end": round(ws[b]["end"], 3), "text": sent})
        k += n
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
    ap.add_argument("--asr", default="medium.en")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    from qwen_tts import Qwen3TTSModel
    tts = Qwen3TTSModel.from_pretrained(a.model, device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    asr = WhisperModel(a.asr, device="cpu", compute_type="int8", cpu_threads=8)
    for v in script():
        if a.ids and v["id"] not in a.ids:
            continue
        out = os.path.join(HERE, "build", v["id"])
        os.makedirs(os.path.join(out, "voice"), exist_ok=True)
        lines = []
        for i, text in enumerate(v["lines"]):
            ref, takes = words(text), []
            for k in range(TAKES):
                torch.manual_seed(1000 * i + k + 1)
                with torch.inference_mode():
                    waves, sr = tts.generate_custom_voice(text=text, language="English", speaker=SPEAKER, instruct=STYLE,
                                                          max_new_tokens=2400, temperature=0.6, top_p=0.9, repetition_penalty=1.05)
                x = trim(np.asarray(waves[0], dtype=np.float32), sr)
                wav = os.path.join(out, "voice", f"line-{i:02d}-take{k}.wav")
                sf.write(wav, x, sr, subtype="PCM_24")
                x16 = torchaudio.functional.resample(torch.from_numpy(x), sr, 16000).numpy()
                segs, _ = asr.transcribe(x16, language="en", word_timestamps=True, beam_size=5, vad_filter=False)
                ws = merge_numbers([{"w": w.word, "start": w.start, "end": w.end} for s in segs for w in s.words])
                hyp = words(" ".join(w["w"] for w in ws))
                takes.append({"file": wav, "duration": len(x) / sr, "errors": errors(ref, hyp), "gap": longest_gap(ws),
                              "heard": " ".join(w["w"].strip() for w in ws), "words": ws})
            med = float(np.median([t["duration"] for t in takes]))
            ok = [t for t in takes if t["errors"] <= MAX_ERRORS and t["gap"] <= GAP_LIMIT] or takes
            best = min(ok, key=lambda t: (t["errors"], t["gap"] > GAP_LIMIT, abs(t["duration"] - med)))
            keep = os.path.join(out, "voice", f"line-{i:02d}.wav")
            os.replace(best["file"], keep)
            lines.append({"file": f"voice/line-{i:02d}.wav", "duration": round(best["duration"], 3), "text": text,
                          "sentences": sentence_times(text, best["words"]) if best["words"] else [],
                          "takes": [{"errors": t["errors"], "gap": round(t["gap"], 2), "duration": round(t["duration"], 2)} for t in takes],
                          "words": [{"w": w["w"].strip(), "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in best["words"]],
                          "kept": {"errors": best["errors"], "gap": round(best["gap"], 2), "heard": best["heard"]}})
            flag = "" if best["errors"] <= MAX_ERRORS and best["gap"] <= GAP_LIMIT else "   <-- CHECK"
            print(f"{v['id']} line {i}: {best['duration']:.1f} s, {best['errors']} word errors, longest pause {best['gap']:.2f} s "
                  f"(takes: {[t['errors'] for t in takes]}){flag}", flush=True)
        for f in os.listdir(os.path.join(out, "voice")):
            if "take" in f:
                os.remove(os.path.join(out, "voice", f))
        json.dump({"speaker": SPEAKER, "style": STYLE, "scenes": lines[:-1], "outro": lines[-1]},
                  open(os.path.join(out, "narration.json"), "w"), indent=1)
        print(f"{v['id']}: {len(lines)} lines, {sum(l['duration'] for l in lines):.1f} s of narration")


if __name__ == "__main__":
    main()
