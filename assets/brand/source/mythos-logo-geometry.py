#!/usr/bin/env python3
"""
MYTHOS master logo — canonical geometry (Stage 1B, logo evolution).

Single source of truth for every Mythos logo master. All coordinates are
expressed on a 1000-unit cap-height grid with the origin at the top-left of
the cap band and y increasing downward, matching the SVG user space.

Geometry is derived from the highest-quality historical source,
`assets/logos/logomythos.png` (see docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md),
measured at cap height 166 px and rationalized. Rationalization is recorded in
docs/design/LOGO_SYSTEM.md; nothing here is invented free-hand.

Run `python3 mythos-logo-geometry.py --emit <dir>` to regenerate the masters.
"""

# ----------------------------------------------------------------------------
# Rationalized constants (measured value -> adopted value)
# ----------------------------------------------------------------------------
CAP    = 1000     # cap height, the unit of the system
SLANT  = 0.70     # dx/dy of every M diagonal; 34.9 deg measured -> exactly 35.0 deg
STEM   = 260      # vertical stroke weight  (measured 43px * 6.024 = 259)
HBAR   = 210      # horizontal stroke weight; lighter than STEM by optical convention

# Measured ink gaps between letters at source scale, in cap-1000 units.
GAPS   = {'MY': 60, 'YT': 48, 'TH': 72, 'HO': 66, 'OS': 54}

def _poly(pts):
    return 'M' + ' L'.join(f'{x:.0f} {y:.0f}' for x, y in pts) + ' Z'

# ----------------------------------------------------------------------------
# Glyphs
# ----------------------------------------------------------------------------
# M — THE PROTECTED GLYPH. Slanted left leg and inner wedge at exactly 35 deg
# against an upright right stem; twin flat apexes; centre wedge descending to a
# point on the baseline. This asymmetry is the identity and must not be altered.
M_W = 1380
M   = _poly([(0, 1000), (700, 0), (960, 0), (960, 230), (1120, 0), (1380, 0),
             (1380, 1000), (1120, 1000), (1120, 414), (710, 1000), (710, 429),
             (310, 1000)])

Y_W = 966
Y   = _poly([(0, 0), (290, 0), (483, 470), (676, 0), (966, 0), (614, 640),
             (614, 1000), (352, 1000), (352, 640)])

T_W = 760
T   = _poly([(0, 0), (760, 0), (760, 230), (510, 230), (510, 1000), (250, 1000),
             (250, 230), (0, 230)])

H_W = 883
H   = _poly([(0, 0), (264, 0), (264, 395), (619, 395), (619, 0), (883, 0),
             (883, 1000), (619, 1000), (619, 605), (264, 605), (264, 1000),
             (0, 1000)])

# O — true geometric ring: outer 1040x1000, inner 530x490, concentric.
O_W = 1040
O   = ('M520 0 A520 500 0 1 0 520 1000 A520 500 0 1 0 520 0 Z '
       'M520 255 A265 245 0 1 1 520 745 A265 245 0 1 1 520 255 Z')

# S — rationalized from the traced original: full-width flat terminals,
# 210-unit arms, straight diagonal spine with crisp junctions.
S_W = 745
S   = ('M313 0 C243.5 8.3 210.5 17.0 164 39 C117.5 61.0 91.3 81.2 62 119 '
       'C32.7 156.8 15.4 198.9 6 243 C-3.4 287.1 -6.0 312.2 11 357 '
       'C28.0 401.8 17.3 430.9 98 485 C178.7 539.1 420 636 447 649 '
       'C471 661 465 700 460 726 C455 752 436 774 408 790 '
       'L0 790 L0 1000 L356 1000 '
       'C454.1 997.2 474.3 1000.4 530 985 C585.7 969.6 619.4 950.5 657 917 '
       'C694.6 883.5 716.7 852.1 733 804 C749.3 755.9 759.8 712.0 745 657 '
       'C730.2 602.0 680 545 653 507 C641 490 330 358 295 345 '
       'C275 337 262 325 262 306 C262 288 268 274 285 262 L343 210 '
       'L742 210 L742 0 Z')

ORDER  = ['M', 'Y', 'T', 'H', 'O', 'S']
GLYPH  = {'M': M, 'Y': Y, 'T': T, 'H': H, 'O': O, 'S': S}
WIDTH  = {'M': M_W, 'Y': Y_W, 'T': T_W, 'H': H_W, 'O': O_W, 'S': S_W}


def offsets(track=0):
    """Left offset of each letter and the total wordmark width."""
    out, x = {}, 0
    for i, L in enumerate(ORDER):
        out[L] = x
        x += WIDTH[L]
        if i < len(ORDER) - 1:
            x += GAPS[L + ORDER[i + 1]] + track
    return out, x


WORDMARK_W = offsets()[1]          # 6094 units => aspect ratio 6.094 : 1


def wordmark(fill='currentColor', track=0, indent=''):
    off, _ = offsets(track)
    return '\n'.join(
        f'{indent}<path fill="{fill}" transform="translate({off[L]} 0)" d="{GLYPH[L]}"/>'
        for L in ORDER)


def symbol(fill='currentColor', indent=''):
    """The M used alone. An extension of the identity, never a replacement
    for the wordmark (see docs/design/LOGO_SYSTEM.md 5)."""
    return f'{indent}<path fill="{fill}" d="{M}"/>'
