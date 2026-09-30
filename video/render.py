"""Draws every frame of a demo video from its recorded timeline and encodes the picture.

  python video/render.py [--ffmpeg PATH] [--workers N] [--check] [id ...]

Reads build/<id>/timeline.json, states/*.png (4x screenshots of the app), cards/ (cards.cjs). Each frame is the
backdrop and the app window seen through a camera that eases between framings, a drawn cursor that glides along
the recorded path with a ripple on every click, chapter labels, and the designed cards cross-fading in and out.
Before drawing anything it checks the timeline: every click lands inside its target, every pointed-at spot stays
inside the frame with a margin, and no zoom goes past what the capture density keeps sharp. --check stops there.
Writes build/<id>/picture.mp4 (60 fps, no sound) and build/<id>/frames.json (camera per frame, for the gates).
"""
import argparse
import json
import math
import os
import subprocess
import sys
from multiprocessing import Pool

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 60
W, H = 1920, 1080
CAM_TIME = 1.0        # seconds a camera move takes
STATE_FADE = 0.12     # cross-fade between two screenshots of the app
CARD_FADE = 0.5       # cross-fade into a card or back to the app
CURSOR = 26           # cursor height in frame pixels at zoom 1


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * x * (x * (x * 6 - 15) + 10)


def font(bold=False, size=30):
    name = "Trebuchet MS:bold" if bold else "Trebuchet MS"
    try:
        path = subprocess.check_output(["fc-match", "-f", "%{file}", name], text=True)
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default(size)


class Timeline:
    def __init__(self, d):
        self.dir = d
        self.tl = json.load(open(os.path.join(d, "timeline.json")))
        self.cards = json.load(open(os.path.join(d, "cards", "cards.json")))
        L = self.tl["layout"]
        self.ox, self.oy = L["content"]
        self.vw, self.vh = self.tl["viewport"]["width"], self.tl["viewport"]["height"]
        self.dpr = self.tl["dpr"]
        self.cam = self.tl["camera"]
        self.frames = round(self.tl["duration"] * FPS)

        # each camera move starts from wherever the previous one had got to
        self.cam_from, cur = [], (1.0, W / 2, H / 2)
        for i, k in enumerate(self.cam):
            if i:
                cur = self._ease(self.cam_from[i - 1], self.cam[i - 1], k["t"])
            self.cam_from.append(cur)

    @staticmethod
    def _ease(start, k, t):
        e = smooth((t - k["t"]) / CAM_TIME)
        z = math.exp(math.log(start[0]) + (math.log(k["zoom"]) - math.log(start[0])) * e)
        return (z, start[1] + (k["center"][0] - start[1]) * e, start[2] + (k["center"][1] - start[2]) * e)

    def camera(self, t):
        """(zoom, cx, cy): the frame shows the zoom-1 layout scaled by zoom around (cx, cy)."""
        idx = max([i for i, k in enumerate(self.cam) if k["t"] <= t], default=None)
        if idx is None:
            return (1.0, W / 2, H / 2)
        return self._ease(self.cam_from[idx], self.cam[idx], t)

    def cursor(self, t):
        """Cursor position (CSS px of the page) and press depth 0..1."""
        pos = None
        for m in self.tl["moves"]:
            if t < m["t0"]:
                pos = pos or m["from"]
                break
            if t <= m["t1"]:
                e = smooth((t - m["t0"]) / max(1e-6, m["t1"] - m["t0"]))
                (x0, y0), (x1, y1) = m["from"], m["to"]
                bend = 0.08 * math.hypot(x1 - x0, y1 - y0)   # a slight arc reads as a hand, a straight line as a robot
                nx, ny = -(y1 - y0), x1 - x0
                n = math.hypot(nx, ny) or 1
                off = bend * math.sin(math.pi * e)
                pos = (x0 + (x1 - x0) * e + nx / n * off, y0 + (y1 - y0) * e + ny / n * off)
                break
            pos = m["to"]
        if pos is None:
            pos = self.tl["moves"][0]["from"] if self.tl["moves"] else (self.vw * .66, self.vh * .58)
        press = 0.0
        for c in self.tl["clicks"]:
            dt = t - c["t"]
            if 0 <= dt < 0.35:
                press = max(press, 1 - dt / 0.35 if dt > 0.08 else dt / 0.08)
        return pos, press

    def to_frame(self, cam, x, y):
        """Page CSS px -> output pixels through the camera."""
        z, cx, cy = cam
        return ((self.ox + x - (cx - W / 2 / z)) * z, (self.oy + y - (cy - H / 2 / z)) * z)

    def segments_at(self, t):
        segs = self.tl["segments"]
        vis = [s for s in segs if s["t0"] <= t <= s["t1"] + CARD_FADE]
        out = []
        for s in vis:
            first = s is segs[0]
            a = 1.0 if first else smooth((t - s["t0"]) / CARD_FADE)
            out.append((s, a))
        # drop layers fully covered by a later opaque one
        for i in range(len(out) - 1, -1, -1):
            if out[i][1] >= 1:
                return out[i:]
        return out


# ---------- checks (run before any drawing) ----------
def check(tlo):
    tl, problems = tlo.tl, []
    m = tl["margin"]
    for k in tl["camera"]:
        if k["zoom"] > tlo.dpr / 1.5 + 1e-6:
            problems.append(f"zoom {k['zoom']:.2f} at {k['t']:.2f}s is past the sharp limit {tlo.dpr / 1.5:.2f}")
        if k["font"] and k["font"] * k["zoom"] < 28 - 1e-6:
            problems.append(f"text in {k['what']} is {k['font'] * k['zoom']:.1f} px at {k['t']:.2f}s (needs 28)")

    for k in tl["camera"]:
        if k["font"]:   # text being read must be wholly in view once the camera has arrived
            z, cx, cy = tlo.camera(k["t"] + CAM_TIME)
            (ax, ay), (bx, by) = tlo.to_frame((z, cx, cy), k["rect"][0], k["rect"][1]), tlo.to_frame((z, cx, cy), k["rect"][2], k["rect"][3])
            if ax < -1 or ay < -1 or bx > W + 1 or by > H + 1:
                problems.append(f"{k['what']} at {k['t']:.2f}s is cut off by the frame")

    def inside(t, x, y, what):
        cam = tlo.camera(t)
        fx, fy = tlo.to_frame(cam, x, y)
        if not (W * m <= fx <= W * (1 - m) and H * m <= fy <= H * (1 - m)):
            problems.append(f"{what} at {t:.2f}s is at ({fx:.0f}, {fy:.0f}), outside the frame margin")
    for c in tl["clicks"]:
        (x, y), (x0, y0, x1, y1) = c["at"], c["box"]
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            problems.append(f"click on {c['what']} at {c['t']:.2f}s misses its target")
        (cx, cy), _ = tlo.cursor(c["t"])
        if math.hypot(cx - x, cy - y) > 4:
            problems.append(f"cursor is {math.hypot(cx - x, cy - y):.1f} px from the click at {c['t']:.2f}s")
        inside(c["t"], x, y, f"click on {c['what']}")
    app = next(s for s in tl["segments"] if s["kind"] == "app")
    for mv in tl["moves"]:
        if mv["t1"] <= app["t1"]:
            inside(mv["t1"], *mv["to"], "pointer target")
    return problems


# ---------- drawing ----------
class Painter:
    def __init__(self, d):
        self.t = Timeline(d)
        self.back = Image.open(os.path.join(d, "cards", "backdrop.png")).convert("RGB")
        self.bscale = self.back.width / W
        self.states = {}
        self.cardcache = {}
        r = self.t.tl["layout"]["radius"] * self.t.dpr
        big = Image.new("L", (self.t.vw * self.t.dpr, self.t.vh * self.t.dpr), 255)
        dr = ImageDraw.Draw(big)
        dr.rectangle((0, big.height - r, r, big.height), fill=0)
        dr.rectangle((big.width - r, big.height - r, big.width, big.height), fill=0)
        dr.pieslice((0, big.height - 2 * r, 2 * r, big.height), 90, 180, fill=255)
        dr.pieslice((big.width - 2 * r, big.height - 2 * r, big.width, big.height), 0, 90, fill=255)
        self.mask = big
        self.cursor_img = self._cursor_sprite()
        self.chapters = {}
        self.f_chap = font(True, 30)

    def _cursor_sprite(self):
        s = 8   # draw 8x and scale down
        pts = [(3, 2), (3, 19.5), (7.6, 15.4), (10.7, 22.2), (13.6, 21), (10.6, 14.4), (16.6, 14.2)]
        img = Image.new("RGBA", (24 * s, 26 * s), (0, 0, 0, 0))
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).polygon([((x + .6) * s, (y + 1.2) * s) for x, y in pts], fill=(0, 0, 0, 110))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(1.3 * s)))
        d = ImageDraw.Draw(img)
        d.polygon([(x * s, y * s) for x, y in pts], fill=(255, 255, 255, 255))
        inner = [(3.9, 4.3), (3.9, 17.5), (7.9, 13.9), (11.1, 20.9), (12.6, 20.3), (9.4, 13.3), (14.5, 13.2)]
        d.polygon([(x * s, y * s) for x, y in inner], fill=(24, 32, 26, 255))
        return img

    def state_img(self, f):
        if f not in self.states:
            if len(self.states) > 6:
                self.states.pop(next(iter(self.states)))
            self.states[f] = Image.open(os.path.join(self.t.dir, f)).convert("RGB")
        return self.states[f]

    def card(self, name, i):
        n = self.t.cards["frames"][name]
        i = min(max(i, 0), n - 1)
        key = (name, i)
        if key not in self.cardcache:
            if len(self.cardcache) > 8:
                self.cardcache.pop(next(iter(self.cardcache)))
            self.cardcache[key] = Image.open(os.path.join(self.t.dir, "cards", name, f"{i:05d}.png")).convert("RGB")
        return self.cardcache[key]

    def app_frame(self, t):
        T = self.t
        app = next(s for s in T.tl["segments"] if s["kind"] == "app")
        t = min(max(t, app["t0"]), app["t1"])
        z, cx, cy = T.camera(t)
        vx, vy = cx - W / 2 / z, cy - H / 2 / z
        s = self.bscale
        bw, bh = self.back.size
        box = (max(0, vx * s), max(0, vy * s), min(bw, (vx + W / z) * s), min(bh, (vy + H / z) * s))
        frame = self.back.resize((W, H), Image.BICUBIC, box=box, reducing_gap=2.0)
        # the page: the part of the content rectangle the camera sees
        x0, y0 = max(vx, T.ox), max(vy, T.oy)
        x1, y1 = min(vx + W / z, T.ox + T.vw), min(vy + H / z, T.oy + T.vh)
        if x1 > x0 and y1 > y0:
            dx0, dy0 = round((x0 - vx) * z), round((y0 - vy) * z)
            dx1, dy1 = round((x1 - vx) * z), round((y1 - vy) * z)
            # source box that maps exactly onto the integer destination box
            sx0, sy0 = (dx0 / z + vx - T.ox) * T.dpr, (dy0 / z + vy - T.oy) * T.dpr
            sx1, sy1 = (dx1 / z + vx - T.ox) * T.dpr, (dy1 / z + vy - T.oy) * T.dpr
            mw, mh = self.mask.size
            box, size = (max(0, sx0), max(0, sy0), min(mw, sx1), min(mh, sy1)), (dx1 - dx0, dy1 - dy0)
            states = T.tl["states"]
            k = max(i for i, st in enumerate(states) if st["t"] <= t) if states[0]["t"] <= t else 0
            img = self.state_img(states[k]["file"]).resize(size, Image.LANCZOS, box=box, reducing_gap=3.0)
            fade = (t - states[k]["t"]) / STATE_FADE
            if k > 0 and fade < 1:
                prev = self.state_img(states[k - 1]["file"]).resize(size, Image.LANCZOS, box=box, reducing_gap=3.0)
                img = Image.blend(prev, img, smooth(fade))
            corner = T.tl["layout"]["radius"] * T.dpr * 2
            if sy1 > self.mask.height - corner:
                frame.paste(img, (dx0, dy0), self.mask.resize(size, Image.BILINEAR, box=box))
            else:
                frame.paste(img, (dx0, dy0))
        # cursor and click ripples
        (px, py), press = T.cursor(t)
        fx, fy = T.to_frame((z, cx, cy), px, py)
        scale = z ** 0.75
        over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(over)
        for c in T.tl["clicks"]:
            dt = t - c["t"]
            if 0 <= dt < 0.6:
                e = smooth(dt / 0.6)
                cxp, cyp = T.to_frame((z, cx, cy), *c["at"])
                r = (10 + 30 * e) * scale
                a = int(200 * (1 - e))
                d.ellipse((cxp - r, cyp - r, cxp + r, cyp + r), outline=(241, 206, 120, a), width=max(2, round(3 * scale)))
                r2 = r * 0.55
                d.ellipse((cxp - r2, cyp - r2, cxp + r2, cyp + r2), fill=(241, 206, 120, a // 3))
        hgt = CURSOR * scale * (1 - 0.14 * press)
        cur = self.cursor_img.resize((max(1, round(hgt * 24 / 26)), max(1, round(hgt))), Image.LANCZOS)
        tip = (3 / 26 * hgt, 2 / 26 * hgt)
        over.alpha_composite(cur, (max(0, round(fx - tip[0])), max(0, round(fy - tip[1]))))
        # chapter label
        for sc in T.tl["scenes"]:
            if sc["chapter"] and sc["start"] + 0.2 <= t <= sc["start"] + 3.6:
                a = min(smooth((t - sc["start"] - 0.2) / 0.35), smooth((sc["start"] + 3.6 - t) / 0.35))
                over.alpha_composite(self.chapter(sc["chapter"], a), (56, 48))
        frame = frame.convert("RGBA")
        frame.alpha_composite(over)
        return frame.convert("RGB")

    def chapter(self, text, a):
        if text not in self.chapters:
            tw = self.f_chap.getlength(text)
            img = Image.new("RGBA", (int(tw) + 92, 64), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            d.rounded_rectangle((0, 0, img.width - 1, 63), radius=32, fill=(24, 36, 27, 232), outline=(244, 239, 228, 40))
            d.ellipse((26, 26, 38, 38), fill=(241, 206, 120, 255))
            d.text((54, 32), text, font=self.f_chap, fill=(244, 239, 228, 255), anchor="lm")
            self.chapters[text] = img
        img = self.chapters[text].copy()
        img.putalpha(img.getchannel("A").point(lambda v: int(v * a)))
        return img

    def frame(self, n):
        t = n / FPS
        out = None
        for seg, a in self.t.segments_at(t):
            if seg["kind"] == "app":
                img = self.app_frame(t)
            else:
                img = self.card(seg["card"], round((t - seg["t0"]) * FPS))
            out = img if out is None or a >= 1 else Image.blend(out, img, a)
        return out


def worker(args):
    d, start, end, path, ffmpeg = args
    p = Painter(d)
    enc = subprocess.Popen([ffmpeg, "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-vf", "scale=out_color_matrix=bt709:out_range=tv", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "animation",
                            "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-g", "120", path],
                           stdin=subprocess.PIPE)
    for n in range(start, end):
        enc.stdin.write(p.frame(n).tobytes())
    enc.stdin.close()
    if enc.wait():
        raise RuntimeError(f"ffmpeg failed on {path}")
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 4))
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--still", type=float, action="append", default=[], help="write build/<id>/still-<t>.png instead of rendering")
    ap.add_argument("ids", nargs="*")
    a = ap.parse_args()
    for vid in sorted(os.listdir(os.path.join(HERE, "build"))):
        d = os.path.join(HERE, "build", vid)
        if (a.ids and vid not in a.ids) or not os.path.exists(os.path.join(d, "timeline.json")):
            continue
        tlo = Timeline(d)
        problems = check(tlo)
        for p in problems:
            print(f"{vid}: {p}", file=sys.stderr)
        if problems:
            sys.exit(f"{vid}: {len(problems)} timeline problems")
        print(f"{vid}: timeline ok ({len(tlo.tl['clicks'])} clicks, {len(tlo.tl['camera'])} camera moves, max zoom {max(k['zoom'] for k in tlo.cam):.2f})")
        if a.check:
            continue
        if a.still:
            p = Painter(d)
            for t in a.still:
                p.frame(round(t * FPS)).save(os.path.join(d, f"still-{t:g}.png"))
            continue
        json.dump([tlo.camera(n / FPS) for n in range(0, tlo.frames, FPS // 4)], open(os.path.join(d, "frames.json"), "w"))
        n = a.workers
        cuts = [round(tlo.frames * i / n) for i in range(n + 1)]
        jobs = [(d, cuts[i], cuts[i + 1], os.path.join(d, f"part-{i:02d}.mp4"), a.ffmpeg) for i in range(n) if cuts[i + 1] > cuts[i]]
        with Pool(len(jobs)) as pool:
            parts = pool.map(worker, jobs)
        lst = os.path.join(d, "parts.txt")
        open(lst, "w").write("".join(f"file '{os.path.basename(p)}'\n" for p in parts))
        subprocess.run([a.ffmpeg, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", os.path.join(d, "picture.mp4")], check=True)
        for p in parts:
            os.remove(p)
        os.remove(lst)
        print(f"{vid}: {tlo.frames} frames, {tlo.frames / FPS:.1f} s")


if __name__ == "__main__":
    main()
