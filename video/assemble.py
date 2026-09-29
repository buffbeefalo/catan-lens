"""Finishes each video: the narration mixed onto the timeline and mastered, captions timed to the spoken words, the
picture and sound muxed, a poster frame and a transcript. Writes out/<id>.mp4, .vtt, .txt and .jpg.

  python video/assemble.py [--ffmpeg PATH] [id ...]

Sound: every line is placed where its scene starts; the voice gets a low-cut, a gentle de-esser and light compression,
then two-pass loudness normalisation to -16 LUFS integrated with true peaks at or under -1.5 dBTP (the usual target
for web video). No music: nobody on this project can listen to judge one, so none is added.
"""
import argparse
import json
import os
import re
import subprocess

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = {"I": -16.0, "TP": -1.5, "LRA": 7.0}
VOICE_FX = "highpass=f=75:poles=2,deesser=i=0.35:m=0.5:f=0.5,acompressor=threshold=-22dB:ratio=2.2:attack=10:release=180:knee=6:makeup=1.5"
LINE, CUE_SECONDS = 42, 6.0   # caption lines stay short enough to read at a glance


def run(ffmpeg, args, capture=False):
    r = subprocess.run([ffmpeg, "-hide_banner", "-nostats", *args], check=True, capture_output=True, text=True)
    return r.stderr if capture else None


def loudness(ffmpeg, path, extra=""):
    err = run(ffmpeg, ["-i", path, "-af", f"{extra}loudnorm=I={TARGET['I']}:TP={TARGET['TP']}:LRA={TARGET['LRA']}:print_format=json", "-f", "null", "-"], True)
    return json.loads(err[err.rindex("{"):err.rindex("}") + 1])


def stamp(t):
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def norm(text):
    from narrate import words
    return words(text)


def timed_words(line):
    """The script's own words (with punctuation), each with the time it is spoken, from the kept take's word timings."""
    toks = [(w["start"], w["end"]) for w in line["words"] for _ in norm(w["w"])]
    out, k = [], 0
    for sw in line["text"].split():
        n = len(norm(sw))
        if n == 0:
            continue
        span = toks[k:k + n] or [toks[-1]]
        out.append({"w": sw, "start": span[0][0], "end": span[-1][1]})
        k += n
    return out


def two_lines(text):
    """The text as one line, or two balanced lines, each at most LINE characters; None if it cannot fit."""
    if len(text) <= LINE:
        return text
    cuts = [m.start() for m in re.finditer(" ", text) if m.start() <= LINE and len(text) - m.start() - 1 <= LINE]
    if not cuts:
        return None
    cut = min(cuts, key=lambda p: abs(p - len(text) / 2))
    return text[:cut] + "\n" + text[cut + 1:]


def cues(words, at):
    """Groups words into captions of at most two short lines, breaking at sentence ends, then clause ends."""
    out, cur = [], []
    def flush():
        if cur:
            out.append(cur[:])
            cur.clear()
    for i, w in enumerate(words):
        cur.append(w)
        text = " ".join(x["w"] for x in cur)
        nxt = words[i + 1] if i + 1 < len(words) else None
        grow = nxt and not two_lines(text + " " + nxt["w"]) or nxt and nxt["end"] - cur[0]["start"] > CUE_SECONDS
        if re.search(r"[.!?][\"”]?$", w["w"]) or grow or (re.search(r"[,;:]$", w["w"]) and len(text) > LINE):
            flush()
    flush()
    vtt = []
    for i, c in enumerate(out):
        text = " ".join(x["w"] for x in c)
        text = two_lines(text) or text
        start = at + c[0]["start"]
        end = at + c[-1]["end"] + 0.25
        if i + 1 < len(out):
            end = min(end, at + out[i + 1][0]["start"] - 0.02)
        vtt.append((start, max(end, start + 0.8), text))
    return vtt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    out = os.path.join(HERE, "out")
    os.makedirs(out, exist_ok=True)
    for vid in sorted(os.listdir(os.path.join(HERE, "build"))):
        d = os.path.join(HERE, "build", vid)
        if (a.ids and vid not in a.ids) or not os.path.exists(os.path.join(d, "picture.mp4")):
            continue
        tl = json.load(open(os.path.join(d, "timeline.json")))
        nar = json.load(open(os.path.join(d, "narration.json")))
        lines = [(s["voice"], n) for s, n in zip(tl["scenes"], nar["scenes"])] + [(tl["outro"]["voice"], nar["outro"])]
        sr = sf.info(os.path.join(d, lines[0][1]["file"])).samplerate
        track = np.zeros(int(tl["duration"] * sr) + sr, np.float32)
        vtt, words = ["WEBVTT", ""], []
        for at, line in lines:
            x, _ = sf.read(os.path.join(d, line["file"]), dtype="float32")
            i = int(round(at * sr))
            track[i:i + len(x)] += x
            for start, end, text in cues(timed_words(line), at):
                vtt += [f"{stamp(start)} --> {stamp(end)}", text, ""]
            words.append(line["text"])
        raw = os.path.join(d, "voice.wav")
        sf.write(raw, track[:int(tl["duration"] * sr)], sr, subtype="FLOAT")
        # master: resample, treat the voice, measure, then normalise in one linear pass
        pre = f"aresample=48000:resampler=soxr:precision=28,{VOICE_FX},pan=stereo|c0=c0|c1=c0,"   # stereo before measuring: two channels read 3 dB louder
        m = loudness(a.ffmpeg, raw, pre)
        ln = (f"loudnorm=I={TARGET['I']}:TP={TARGET['TP']}:LRA={TARGET['LRA']}:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
              f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        mix = os.path.join(d, "mix.wav")
        run(a.ffmpeg, ["-y", "-i", raw, "-af", pre + ln + ",aresample=48000", "-c:a", "pcm_s24le", mix])
        open(os.path.join(out, f"{vid}.vtt"), "w").write("\n".join(vtt))
        open(os.path.join(out, f"{vid}.txt"), "w").write(" ".join(words) + "\n")
        mp4 = os.path.join(out, f"{vid}.mp4")
        run(a.ffmpeg, ["-y", "-i", os.path.join(d, "picture.mp4"), "-i", mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
                       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart",
                       "-metadata", f"title={tl['title']}", mp4])
        poster = 1.9   # the title card, fully drawn
        run(a.ffmpeg, ["-y", "-ss", f"{poster:.2f}", "-i", mp4, "-frames:v", "1", "-q:v", "2", os.path.join(out, f"{vid}.jpg")])
        final = loudness(a.ffmpeg, mp4)
        print(f"{vid}: {tl['duration']:.1f} s, {os.path.getsize(mp4) / 1e6:.1f} MB, {final['input_i']} LUFS, true peak {final['input_tp']} dBTP")


if __name__ == "__main__":
    main()
