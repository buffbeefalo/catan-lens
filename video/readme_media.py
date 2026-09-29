"""Images for the README, taken from the videos' own lossless frames so they always match what the videos show:
a hero shot, four feature shots, and a thumbnail per video with a play button and its running time.

  python video/readme_media.py        (after render.py; writes docs/media/*.jpg)
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render  # noqa: E402

OUT = os.path.join(HERE, "..", "docs", "media")
# (file, video, seconds): moments where the camera has settled on something worth showing
SHOTS = [
    ("hero.jpg", "overview", 3.8),
    ("feature-why.jpg", "overview", 29.0),
    ("feature-draft.jpg", "walkthrough", 66.0),
    ("feature-drill.jpg", "walkthrough", 102.0),
    ("feature-board.jpg", "walkthrough", 119.0),
]


def save(img, name, width):
    img.resize((width, round(img.height * width / img.width)), Image.LANCZOS).save(os.path.join(OUT, name), quality=88, optimize=True, progressive=True)


def thumbnail(frame, seconds):
    img = frame.convert("RGBA")
    over = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    cx, cy, r = img.width // 2, int(img.height * 0.80), 70
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((cx - r, cy - r + 10, cx + r, cy + r + 10), fill=(0, 0, 0, 110))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16)))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(241, 206, 120, 255))
    d.polygon([(cx - 22, cy - 34), (cx - 22, cy + 34), (cx + 36, cy)], fill=(29, 43, 31, 255))
    label = f"{int(seconds // 60)}:{round(seconds % 60):02d}"
    f = render.font(True, 34)
    w = f.getlength(label)
    x1, y1 = img.width - 48, img.height - 44
    d.rounded_rectangle((x1 - w - 36, y1 - 56, x1, y1), radius=12, fill=(24, 36, 27, 225))
    d.text((x1 - w / 2 - 18, y1 - 28), label, font=f, fill=(244, 239, 228, 255), anchor="mm")
    img.alpha_composite(over)
    return img.convert("RGB")


def main():
    os.makedirs(OUT, exist_ok=True)
    painters = {}
    for name, vid, t in SHOTS:
        p = painters.setdefault(vid, render.Painter(os.path.join(HERE, "build", vid)))
        save(p.frame(round(t * render.FPS)), name, 1600 if name == "hero.jpg" else 1200)
    for vid, p in painters.items():
        dur = json.load(open(os.path.join(HERE, "build", vid, "timeline.json")))["duration"]
        save(thumbnail(p.frame(round(1.9 * render.FPS)), dur), f"video-{vid}.jpg", 1200)
    for f in sorted(os.listdir(OUT)):
        print(f"docs/media/{f}: {os.path.getsize(os.path.join(OUT, f)) // 1024} KB")


if __name__ == "__main__":
    main()
