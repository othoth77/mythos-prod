#!/usr/bin/env python3
"""Render a single review contact sheet of the proposed MYTHOS logo system.

    python3 build-review-sheet.py     # -> ../export/mythos-logo-review-sheet.png

The sheet is a review artifact for validation, not a brand asset.
"""
import io, os
import cairosvg
from PIL import Image, ImageDraw

HERE   = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, '..', 'master')
OUT    = os.path.join(HERE, '..', 'export', 'mythos-logo-review-sheet.png')

INK, PAPER, MUTED = '#0E0E0E', '#F5F3EF', '#8A857B'
W, PAD = 2000, 90


def render(name, width, bg=None):
    png = cairosvg.svg2png(url=os.path.join(MASTER, name), output_width=width,
                           background_color=bg)
    return Image.open(io.BytesIO(png)).convert('RGBA')


def main():
    rows = []                                   # (label, image, ground)
    rows.append(('Primary wordmark — light ground',
                 render('mythos-wordmark-ink.svg', 1500), PAPER))
    rows.append(('Primary wordmark — reversed on dark',
                 render('mythos-wordmark-reversed.svg', 1500), INK))
    for unit in ('prod', 'os', 'digital', 'services', 'logistique'):
        rows.append((f'Business-unit lockup — Mythos {unit.capitalize()}',
                     render(f'mythos-lockup-{unit}.svg', 1000), PAPER))
    rows.append(('Symbol — the M alone',
                 render('mythos-symbol-m-ink.svg', 420), PAPER))

    # small-size and icon strips composited side by side
    strip = Image.new('RGBA', (1500, 300), PAPER)
    x = 0
    for w in (300, 200, 130, 90):
        im = render('mythos-wordmark-ink.svg', w)
        strip.alpha_composite(im, (x, (300 - im.height) // 2))
        x += im.width + 60
    rows.append(('Minimum size — 300 / 200 / 130 / 90 px wide', strip, PAPER))

    icons = Image.new('RGBA', (1500, 300), PAPER)
    x = 0
    for w, f in ((256, 'mythos-appicon-dark.svg'), (128, 'mythos-appicon-dark.svg'),
                 (64, 'mythos-favicon.svg'), (32, 'mythos-favicon.svg')):
        im = render(f, w)
        icons.alpha_composite(im, (x, (300 - im.height) // 2))
        x += im.width + 60
    rows.append(('App icon 256 / 128 · favicon 64 / 32', icons, PAPER))

    lh = 58
    H = PAD + sum(r[1].height + lh + PAD for r in rows)
    sheet = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(sheet)
    y = PAD
    for label, im, ground in rows:
        d.text((PAD, y), label.upper(), fill=MUTED)
        y += lh
        band = Image.new('RGB', (W - 2*PAD, im.height + 60), ground)
        band.paste(im, ((band.width - im.width)//2, 30), im)
        sheet.paste(band, (PAD, y))
        y += band.height + PAD
    sheet.save(OUT)
    print('wrote', OUT, sheet.size)


if __name__ == '__main__':
    main()
