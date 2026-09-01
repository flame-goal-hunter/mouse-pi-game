#!/usr/bin/env python3
"""Generate back-view sprites from the existing front-facing character art.

The characters (drawn by hand) all share one commented structure:
  Tail -> Feet -> Body -> Arms -> Ears -> Head -> head decorations -> FACE parts
A back view is the same drawing with the face parts removed and the tail moved
to the centre, so the art itself is never redrawn — only filtered.

Writes www/assets/characters/transylvania/back/<name>.svg for Pi, his walk
frames and every skin (+ their walk frames).
Run: python3 tools/gen_back_views.py
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'www/assets/characters/transylvania'
OUT = SRC / 'back'

# comment keywords that mark a face element (dropped in the back view)
FACE = re.compile(r'eye|nose|mouth|whisker|cheek|smirk|grin|fang|eyebrow|visor|grille|'
                  r'hearts decoration|blush|face', re.I)
# keywords that must stay even if they match above (head-top decorations)
KEEP = re.compile(r'halo|sparkle|antenna|plume|crest|horn|antler|mane|bow|helmet|leaf|crown', re.I)


def sections(svg_body):
    """Split the body into (comment, chunk) pairs, keeping any preamble as ('', ...)."""
    parts, last, cur = [], 0, ''
    for m in re.finditer(r'<!--(.*?)-->', svg_body, re.S):
        parts.append((cur, svg_body[last:m.start()]))
        cur, last = m.group(1).strip(), m.end()
    parts.append((cur, svg_body[last:]))
    return parts


def make_back(svg):
    head, body = svg.split('>', 1)          # keep the <svg ...> tag intact
    body = body.replace('</svg>', '')       # re-appended at the end: a dropped last
                                            # section must not take the closing tag with it
    m = re.search(r'(<defs>.*?</defs>)', body, re.S)
    defs = m.group(1) if m else ''
    rest = body.replace(defs, '') if defs else body
    kept = []
    for comment, chunk in sections(rest):
        if comment and FACE.search(comment) and not KEEP.search(comment):
            continue                        # a face element: drop it
        kept.append((f'<!-- {comment} -->' if comment else '') + chunk)
    out = head + '>' + defs + ''.join(kept) + '\n</svg>\n'
    # the tail is drawn behind the body and reads correctly from behind — left as it is
    return re.sub(r'\n{3,}', '\n\n', out)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(list(SRC.glob('pi*.svg')) + list((SRC / 'skins').glob('*.svg')))
    n = 0
    for f in files:
        svg = f.read_text()
        if '<!--' not in svg:
            print('skip (no structure):', f.name); continue
        (OUT / f.name).write_text(make_back(svg))
        n += 1
    print(f'wrote {n} back views to {OUT}')


if __name__ == '__main__':
    main()
