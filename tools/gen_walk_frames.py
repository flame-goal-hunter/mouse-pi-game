#!/usr/bin/env python3
"""Generate walk1/walk2 frames from a skin's stand frame.

Measured from the nine hand-made skins: a walk frame differs from the stand frame in
exactly two places — the two foot ellipses and the two arm ellipses. Everything else is
copied verbatim, which is what keeps a skin from "breathing" while it walks.

  walk1  left foot  cx -6, cy -7 (lifted forward)   right foot cx +6, cy +7 (planted)
         left arm   cx -2, cy +2, rotate -26        right arm  cx +2, cy -2, rotate +10
  walk2  mirrored

Usage:  python3 tools/gen_walk_frames.py <id> [<id> ...]
        (reads www/assets/characters/transylvania/skins/<id>.svg)
"""
import re
import sys
import pathlib

SKINS = pathlib.Path(__file__).resolve().parent.parent / 'www' / 'assets' / 'characters' / 'transylvania' / 'skins'

FOOT_Y, FOOT_L, FOOT_R = 205, 78, 122
ARM_Y, ARM_L, ARM_R = 158, 52, 148

# (left foot dx,dy), (right foot dx,dy), (left arm dx,dy,rot), (right arm dx,dy,rot)
FRAMES = {
    'walk1': ((-6, -7), (6, 7), (-2, 2, -26), (2, -2, 10)),
    'walk2': ((-6, 7), (6, -7), (-2, -2, -10), (2, 2, 26)),
}


def num(s):
    return float(s) if '.' in s else int(s)


def move_ellipse(svg, cx, cy, dx, dy, rot=None):
    """Shift the one ellipse at (cx, cy); optionally rewrite its rotate()."""
    pat = re.compile(r'<ellipse([^>]*?)cx="%s"([^>]*?)cy="%s"([^>]*?)/>' % (cx, cy))
    m = pat.search(svg)
    if not m:
        return svg, False
    tag = m.group(0)
    ncx, ncy = cx + dx, cy + dy
    out = tag.replace('cx="%s"' % cx, 'cx="%s"' % ncx, 1)
    out = out.replace('cy="%s"' % cy, 'cy="%s"' % ncy, 1)
    if rot is not None:
        out = re.sub(r'transform="rotate\([^)]*\)"',
                     'transform="rotate(%d %s %s)"' % (rot, ncx, ncy), out)
    return svg[:m.start()] + out + svg[m.end():], True


def build(stand, spec):
    (lfx, lfy), (rfx, rfy), (lax, lay, lar), (rax, ray, rar) = spec
    svg = stand
    ok = True
    for args in (
        (FOOT_L, FOOT_Y, lfx, lfy, None),
        (FOOT_R, FOOT_Y, rfx, rfy, None),
        (ARM_L, ARM_Y, lax, lay, lar),
        (ARM_R, ARM_Y, rax, ray, rar),
    ):
        svg, hit = move_ellipse(svg, *args)
        ok = ok and hit
    return svg, ok


def main():
    ids = sys.argv[1:]
    if not ids:
        raise SystemExit('usage: gen_walk_frames.py <skin-id> [...]')
    for sid in ids:
        src = SKINS / ('%s.svg' % sid)
        if not src.exists():
            raise SystemExit('%s: no stand frame at %s' % (sid, src))
        stand = src.read_text()
        for name, spec in FRAMES.items():
            svg, ok = build(stand, spec)
            if not ok:
                raise SystemExit('%s/%s: the skeleton does not match the brief — feet must sit '
                                 'at cx 78/122 cy 205 and arms at cx 52/148 cy 158' % (sid, name))
            (SKINS / ('%s-%s.svg' % (sid, name))).write_text(svg)
        print('wrote %s-walk1.svg, %s-walk2.svg' % (sid, sid))


if __name__ == '__main__':
    main()
