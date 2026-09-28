#!/usr/bin/env python3
"""링크 공유 미리보기 썸네일(assets/og-image.png, 1200×630)을 만든다.

문구·색을 바꾸려면 아래 값을 고치고:  python tools/make_og_image.py
(윈도우 기본 글꼴 '맑은 고딕'을 사용)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "assets" / "og-image.png"
FONT_B = "C:/Windows/Fonts/malgunbd.ttf"
FONT_R = "C:/Windows/Fonts/malgun.ttf"

NIGHT, NIGHT2 = (15, 20, 36), (30, 38, 66)
UP, MX, DN = (229, 56, 59), (242, 183, 5), (36, 99, 235)
WHITE, SUB = (255, 255, 255), (174, 182, 200)


def font(path, size):
    return ImageFont.truetype(path, size)


def main():
    img = Image.new("RGB", (W, H), NIGHT)

    # 세로 그라데이션 배경
    grad = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        grad.line([(0, y), (W, y)], fill=tuple(round(NIGHT[i] + (NIGHT2[i] - NIGHT[i]) * t) for i in range(3)))

    # 은은한 빛 번짐
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse([-200, -260, 520, 300], fill=(90, 22, 30))
    g.ellipse([760, -220, 1440, 360], fill=(14, 40, 110))
    img = ImageChops.add(img, glow.filter(ImageFilter.GaussianBlur(120)))

    d = ImageDraw.Draw(img)

    # 위쪽 신호등 3색 띠
    for i, c in enumerate((UP, MX, DN)):
        d.rectangle([i * W // 3, 0, (i + 1) * W // 3, 10], fill=c)

    # 신호등 본체
    bx, by, bw, bh = 110, 125, 190, 420
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=48, fill=(8, 11, 22), outline=(52, 60, 88), width=3)
    lamps = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lamps)
    cx, r = bx + bw // 2, 52
    for i, c in enumerate((UP, MX, DN)):
        cy = by + 80 + i * 130
        ld.ellipse([cx - r - 18, cy - r - 18, cx + r + 18, cy + r + 18], fill=c + (150,))
    img.paste(lamps.filter(ImageFilter.GaussianBlur(22)), (0, 0), lamps.filter(ImageFilter.GaussianBlur(22)))
    d = ImageDraw.Draw(img)
    for i, c in enumerate((UP, MX, DN)):
        cy = by + 80 + i * 130
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
        d.ellipse([cx - r + 14, cy - r + 10, cx - r + 38, cy - r + 30], fill=tuple(min(255, v + 90) for v in c))

    # 문구
    x = 380
    d.text((x, 150), "AI", font=font(FONT_B, 104), fill=UP)
    ai_w = d.textlength("AI ", font=font(FONT_B, 104))
    d.text((x + ai_w, 150), "신호등", font=font(FONT_B, 104), fill=WHITE)
    d.text((x, 300), "코인 · 나스닥 · 코스피200", font=font(FONT_B, 46), fill=WHITE)
    d.text((x, 368), "매일 업데이트되는 6일 예측 신호", font=font(FONT_R, 38), fill=SUB)

    # 범례
    lx, ly = x, 460
    for c, label in ((UP, "상승"), (MX, "혼돈"), (DN, "하락")):
        d.ellipse([lx, ly + 6, lx + 26, ly + 32], fill=c)
        d.text((lx + 38, ly), label, font=font(FONT_B, 30), fill=WHITE)
        lx += 38 + d.textlength(label, font=font(FONT_B, 30)) + 44

    d.text((x, 540), "www.ai-sinhodeung.co.kr", font=font(FONT_R, 30), fill=(140, 150, 175))

    OUT.parent.mkdir(exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"저장: {OUT}  {OUT.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
