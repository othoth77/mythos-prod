#!/usr/bin/env python3
"""
Regenerate every MYTHOS logo master from the canonical geometry.

    python3 build-masters.py            # writes ../master/*.svg
    python3 build-masters.py --png      # also writes ../export/*.png (needs cairosvg)

Masters are single-colour and use `currentColor` where the host controls the
colour, so one file serves light and dark contexts. Nothing here reads or
writes the historical assets under assets/logos/.
"""
import argparse, importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('geom', os.path.join(HERE, 'mythos-logo-geometry.py'))
G = importlib.util.module_from_spec(spec); spec.loader.exec_module(G)

INK   = '#0E0E0E'      # master ink on light grounds (Mythos OS --bg)
PAPER = '#F5F3EF'      # reversed ink on dark grounds
GOLD  = '#C9A84C'      # descriptor rule; status OPEN pending Stage 1D

PAD = 80               # clear space inside the artboard, in cap units


def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" '
            f'role="img" aria-label="{title}">\n<title>{title}</title>\n{body}\n</svg>\n')


def wordmark_svg(fill, title):
    w, h = G.WORDMARK_W, G.CAP
    return svg(w, h, G.wordmark(fill), title)


def lockup_svg(descriptor, fill, rule=GOLD, title=''):
    """Wordmark with an endorsed business-unit descriptor beneath it.

    This is the original MYTHOS / PROD architecture preserved: the master
    wordmark carries a short descriptor word, flanked by two tapered rules
    that evolve the original's gold spear flourishes into a flat, reproducible
    form. The descriptor is the only part that changes per business unit.
    """
    w = G.WORDMARK_W
    gap, dh = 210, 150
    h = G.CAP + gap + dh
    fs = dh
    track = fs * 0.42
    text = descriptor.upper()
    cy = G.CAP + gap + dh * 0.55                      # optical centre of the band
    # descriptor width estimate: 0.72em per glyph plus tracking
    tw = len(text) * (fs * 0.72 + track)
    inner = tw / 2 + fs * 1.1                         # rule starts clear of the text
    outer = w / 2 - fs * 0.2
    body = [G.wordmark(fill)]
    for sign in (-1, 1):
        x1, x2 = w/2 + sign*inner, w/2 + sign*outer
        t = fs * 0.085                                # rule thickness at its thick end
        body.append(f'<path fill="{rule}" d="M{x1:.0f} {cy-t/2:.0f} L{x2:.0f} {cy:.0f} '
                    f'L{x1:.0f} {cy+t/2:.0f} Z"/>')
    body.append(
        f'<text x="{w/2:.0f}" y="{cy + fs*0.36:.0f}" fill="{fill}" text-anchor="middle" '
        f'font-family="Inter, Helvetica Neue, Arial, sans-serif" font-weight="500" '
        f'font-size="{fs}" letter-spacing="{track:.0f}" dx="{track/2:.0f}">{text}</text>')
    return svg(w, h, '\n'.join(body), title)


def symbol_svg(fill, title):
    return svg(G.M_W, G.CAP, G.symbol(fill), title)


def icon_svg(bg, fg, radius, title, size=1024, cap_ratio=0.46):
    """Square app icon / favicon: the M, optically centred, on a filled tile."""
    m_h = size * cap_ratio                   # cap height inside the tile
    s   = m_h / G.CAP
    m_w = G.M_W * s
    x   = (size - m_w) / 2
    y   = (size - m_h) / 2
    body = (f'<rect width="{size}" height="{size}" rx="{radius}" fill="{bg}"/>\n'
            f'<g transform="translate({x:.1f} {y:.1f}) scale({s:.5f})">'
            f'<path fill="{fg}" d="{G.M}"/></g>')
    return svg(size, size, body, title)


MASTERS = {
    # primary
    'mythos-wordmark.svg':            lambda: wordmark_svg('currentColor', 'MYTHOS'),
    'mythos-wordmark-ink.svg':        lambda: wordmark_svg(INK,   'MYTHOS'),
    'mythos-wordmark-reversed.svg':   lambda: wordmark_svg(PAPER, 'MYTHOS (reversed)'),
    # symbol
    'mythos-symbol-m.svg':            lambda: symbol_svg('currentColor', 'MYTHOS symbol'),
    'mythos-symbol-m-ink.svg':        lambda: symbol_svg(INK,   'MYTHOS symbol'),
    'mythos-symbol-m-reversed.svg':   lambda: symbol_svg(PAPER, 'MYTHOS symbol (reversed)'),
    # endorsed business-unit lockups
    'mythos-lockup-os.svg':           lambda: lockup_svg('OS',         'currentColor', title='Mythos OS'),
    'mythos-lockup-prod.svg':         lambda: lockup_svg('Prod',       'currentColor', title='Mythos Prod'),
    'mythos-lockup-digital.svg':      lambda: lockup_svg('Digital',    'currentColor', title='Mythos Digital'),
    'mythos-lockup-services.svg':     lambda: lockup_svg('Services',   'currentColor', title='Mythos Services'),
    'mythos-lockup-logistique.svg':   lambda: lockup_svg('Logistique', 'currentColor', title='Mythos Logistique'),
    # icons
    'mythos-appicon-dark.svg':        lambda: icon_svg('#0E0E0E', PAPER, 224, 'MYTHOS app icon'),
    'mythos-appicon-light.svg':       lambda: icon_svg(PAPER, '#0E0E0E', 224, 'MYTHOS app icon (light)'),
    'mythos-favicon.svg':             lambda: icon_svg('#0E0E0E', PAPER,  0,  'MYTHOS', size=64, cap_ratio=0.58),
}

PNG_EXPORTS = [
    ('mythos-wordmark-ink.svg',      'mythos-wordmark-ink-2400.png',      2400),
    ('mythos-wordmark-reversed.svg', 'mythos-wordmark-reversed-2400.png', 2400),
    ('mythos-symbol-m-ink.svg',      'mythos-symbol-m-ink-1200.png',      1200),
    ('mythos-appicon-dark.svg',      'mythos-appicon-512.png',             512),
    ('mythos-appicon-dark.svg',      'mythos-appicon-192.png',             192),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--png', action='store_true', help='also render PNG exports')
    ap.add_argument('--out', default=os.path.join(HERE, '..', 'master'))
    ap.add_argument('--png-out', default=os.path.join(HERE, '..', 'export'))
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    for name, fn in MASTERS.items():
        with open(os.path.join(a.out, name), 'w') as f:
            f.write(fn())
        print('master', name)

    if a.png:
        import cairosvg
        os.makedirs(a.png_out, exist_ok=True)
        for src, dst, w in PNG_EXPORTS:
            cairosvg.svg2png(url=os.path.join(a.out, src),
                             write_to=os.path.join(a.png_out, dst), output_width=w)
            print('export', dst)


if __name__ == '__main__':
    main()
