#!/usr/bin/env python3
"""Рисует SVG-схему уровня из того же описания, которое будет читать игра.

Формат уровня — сетка символов плюс объекты. Смысл символов:
    #  стена дома          .  пол комнаты
    :  полость в стене     o  нора (переход комната <-> полость)
    n  гнездо              =  мебель, по ней не ходят

Скрипт нужен, чтобы раскладку можно было посмотреть до того, как она
попадёт в игру, и чтобы формат проверялся глазами, а не воображением.
"""

CELL = 26

# На схеме важнее разборчивость, чем настроение: глухая стена — самая тёмная,
# ход в стене светлее её и с пунктиром по центру, потому что по нему ходят.
# В самой игре ход, наоборот, тёмный — это схема, а не скриншот.
PALETTE = {
    'wall':    '#140d1d',
    'wall_hi': '#1f1530',
    'room':    '#4a3520',
    'room_hi': '#5c4228',
    'cavity':  '#33244a',
    'cavity_l':'#3f2d5b',
    'lamp':    '#f0b44a',
    'cheese':  '#ffd040',
    'cat':     '#d9584b',
    'mouse':   '#6fa8dc',
    'route':   '#f0b44a',
}


def _rect(x, y, w, h, fill, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{extra}/>'


def render(level):
    grid = level['grid']
    rows, cols = len(grid), len(grid[0])
    W, H = cols * CELL, rows * CELL
    out = [f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" '
           f'aria-label="Схема уровня {level["id"]}" style="display:block">']

    # пол, стены, полость
    for r, line in enumerate(grid):
        for c, ch in enumerate(line):
            x, y = c * CELL, r * CELL
            if ch in '.o=':
                out.append(_rect(x, y, CELL, CELL, PALETTE['room']))
                if (r + c) % 2 == 0:
                    out.append(_rect(x, y, CELL, CELL, PALETTE['room_hi'], ' opacity=".45"'))
            elif ch in ':n':
                out.append(_rect(x, y, CELL, CELL, PALETTE['cavity']))
                # стойки каркаса по краям — чтобы ход читался как коридор внутри стены
                out.append(_rect(x, y, 2, CELL, PALETTE['cavity_l']))
                out.append(_rect(x + CELL - 2, y, 2, CELL, PALETTE['cavity_l']))
            else:
                out.append(_rect(x, y, CELL, CELL, PALETTE['wall']))
                out.append(_rect(x, y + CELL - 1, CELL, 1, PALETTE['wall_hi']))
            if ch == '=':
                out.append(_rect(x + 3, y + CELL - 11, CELL - 6, 8, '#6b4a2a', ' rx="2"'))

    def cx(c): return c * CELL + CELL / 2
    def cy(r): return r * CELL + CELL / 2

    # маршрут патруля
    cat = level.get('cat')
    if cat:
        pts = ' '.join(f'{cx(p[0])},{cy(p[1])}' for p in cat['path'])
        out.append(f'<polyline points="{pts}" fill="none" stroke="{PALETTE["cat"]}" '
                   f'stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round" opacity=".7"/>')

    # намеченное решение
    route = level.get('route')
    if route:
        pts = ' '.join(f'{cx(p[0])},{cy(p[1])}' for p in route)
        out.append(f'<polyline points="{pts}" fill="none" stroke="{PALETTE["route"]}" '
                   f'stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round" opacity=".85"/>')

    # пунктир по ходам: показывает, что это проходимый коридор
    for r, line in enumerate(grid):
        for c, ch in enumerate(line):
            if ch in ':n':
                out.append(f'<circle cx="{cx(c)}" cy="{cy(r)}" r="1.6" fill="#8a68c8" opacity=".55"/>')

    # норы
    for r, line in enumerate(grid):
        for c, ch in enumerate(line):
            if ch == 'o':
                out.append(f'<ellipse cx="{cx(c)}" cy="{cy(r) + 4}" rx="9" ry="7" fill="#0d0813"/>')
                out.append(f'<ellipse cx="{cx(c)}" cy="{cy(r) + 4}" rx="9" ry="7" fill="none" '
                           f'stroke="{PALETTE["lamp"]}" stroke-width="1.5" opacity=".55"/>')
            if ch == 'n':
                out.append(f'<circle cx="{cx(c)}" cy="{cy(r)}" r="10" fill="{PALETTE["mouse"]}" opacity=".22"/>')
                out.append(f'<circle cx="{cx(c)}" cy="{cy(r)}" r="6" fill="{PALETTE["mouse"]}"/>')


    # кот и его конус
    if cat:
        hx, hy = cx(cat['at'][0]), cy(cat['at'][1])
        d = cat.get('dir', 1)
        out.append(f'<path d="M{hx} {hy} L{hx + d * 96} {hy - 34} L{hx + d * 96} {hy + 34} Z" '
                   f'fill="{PALETTE["lamp"]}" opacity=".15"/>')
        out.append(f'<circle cx="{hx}" cy="{hy}" r="10" fill="{PALETTE["cat"]}"/>')
        out.append(f'<path d="M{hx - 8} {hy - 7} L{hx - 6} {hy - 14} L{hx - 1} {hy - 8} Z" fill="{PALETTE["cat"]}"/>')
        out.append(f'<path d="M{hx + 1} {hy - 8} L{hx + 6} {hy - 14} L{hx + 8} {hy - 7} Z" fill="{PALETTE["cat"]}"/>')

    # хозяйка
    for w in level.get('lady', []):
        out.append(f'<circle cx="{cx(w[0])}" cy="{cy(w[1])}" r="10" fill="#8a68c8"/>')
        out.append(f'<circle cx="{cx(w[0])}" cy="{cy(w[1]) - 12}" r="16" fill="#8a68c8" opacity=".18"/>')

    # сырки с номером звезды
    for (c, r, tier) in level.get('cheese', []):
        x, y = cx(c), cy(r)
        out.append(f'<path d="M{x - 9} {y + 6} L{x + 9} {y + 6} L{x + 9} {y - 4} Z" fill="{PALETTE["cheese"]}"/>')
        out.append(f'<text x="{x}" y="{y - 8}" text-anchor="middle" font-family="JetBrains Mono, monospace" '
                   f'font-size="10" font-weight="700" fill="{PALETTE["cheese"]}">{tier}</text>')

    # прочие метки
    for (c, r, label) in level.get('marks', []):
        out.append(f'<text x="{cx(c)}" y="{cy(r) + 4}" text-anchor="middle" '
                   f'font-family="JetBrains Mono, monospace" font-size="10" fill="#d8c6a8">{label}</text>')

    out.append('</svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    import json, sys
    print(render(json.load(open(sys.argv[1]))))
