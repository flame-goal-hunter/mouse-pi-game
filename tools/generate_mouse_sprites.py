#!/usr/bin/env python3
"""
Extracts the uploaded illustration of Мышонок Пи ('www/assets/characters/mousie_pi_source.png')
and converts him from sitting-with-cheese into a standing, running character while keeping
100% of the authentic head, ears, eyes, nose, smile, cheeks, fur shading, and tail from the source art!
Generates:
  - bunny1/ (Мышонок Пи — sky-blue mouse)
  - bunny2/ (Мышонок Пу — warm golden-amber mouse)
"""

from collections import deque
import math
import os
import struct
import zlib

from generate_ice_arena import read_png_rgba

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_PATH = os.path.join(ROOT, "www", "assets", "characters", "mousie_pi_source.png")
OUT_DIR_1 = os.path.join(ROOT, "www", "assets", "characters", "bunny1")
OUT_DIR_2 = os.path.join(ROOT, "www", "assets", "characters", "bunny2")


def write_png_rgba(path, width, height, rgba_bytes):
    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        row_start = y * stride
        raw_rows.extend(rgba_bytes[row_start:row_start + stride])

    compressed = zlib.compress(bytes(raw_rows), 9)

    def make_chunk(chunk_type, data):
        chunk = struct.pack(">I", len(data)) + chunk_type + data
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return chunk + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + make_chunk(b"IHDR", ihdr)
        + make_chunk(b"IDAT", compressed)
        + make_chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)


def extract_clean_character(w, h, src_rgba):
    """
    Flood-fills from image border through white background & pale floor shadow,
    keeping interior whites (eyes/highlights) 100% intact, and decontaminates
    the anti-aliased silhouette edge.
    """
    bg_mask = bytearray(w * h)
    q = deque()

    def is_bg_pixel(x, y):
        idx = (y * w + x) * 4
        r, g, b = src_rgba[idx], src_rgba[idx + 1], src_rgba[idx + 2]
        mx = max(r, g, b)
        mn = min(r, g, b)
        sat = mx - mn
        if mn >= 232 and sat <= 24:
            return True
        if y >= 710 and mn >= 172 and sat <= 46 and b >= r:
            return True
        if mn >= 205 and sat <= 34:
            return True
        return False

    for x in range(w):
        for y in (0, h - 1):
            if is_bg_pixel(x, y):
                bg_mask[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not bg_mask[y * w + x] and is_bg_pixel(x, y):
                bg_mask[y * w + x] = 1
                q.append((x, y))

    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg_mask[ny * w + nx]:
                if is_bg_pixel(nx, ny):
                    bg_mask[ny * w + nx] = 1
                    q.append((nx, ny))

    out = bytearray(src_rgba)
    for y in range(h):
        for x in range(w):
            p = y * w + x
            idx = p * 4
            if bg_mask[p]:
                out[idx] = 0
                out[idx + 1] = 0
                out[idx + 2] = 0
                out[idx + 3] = 0
            else:
                bg_neighbors = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and bg_mask[ny * w + nx]:
                            bg_neighbors += 1
                if bg_neighbors > 0:
                    r, g, b = out[idx], out[idx + 1], out[idx + 2]
                    mx = max(r, g, b)
                    mn = min(r, g, b)
                    sat = mx - mn
                    whiteness = max(0.0, min(1.0, (mn - 110.0) / 145.0)) * max(0.0, 1.0 - sat / 95.0)
                    alpha = max(0.0, min(1.0, 1.0 - whiteness * 0.92 - bg_neighbors * 0.04))
                    if alpha < 0.12:
                        out[idx + 3] = 0
                    else:
                        w_mix = 1.0 - alpha
                        cr = int(max(0.0, min(255.0, (r - 250.0 * w_mix) / alpha)))
                        cg = int(max(0.0, min(255.0, (g - 250.0 * w_mix) / alpha)))
                        cb = int(max(0.0, min(255.0, (b - 250.0 * w_mix) / alpha)))
                        out[idx] = cr
                        out[idx + 1] = cg
                        out[idx + 2] = cb
                        out[idx + 3] = int(alpha * 255.0)

    # Find tight bounding box of extracted character
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if out[(y * w + x) * 4 + 3] > 15:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y

    pad_x = 44
    pad_top = 40
    pad_bot = 68  # Extra room at bottom for standing legs!
    min_x = max(0, min_x - pad_x)
    min_y = max(0, min_y - pad_top)
    max_x = min(w - 1, max_x + pad_x)
    max_y = min(h - 1, max_y + pad_bot)

    cw = max_x - min_x + 1
    ch = max_y - min_y + 1
    cropped = bytearray(cw * ch * 4)
    for y in range(ch):
        src_row = ((min_y + y) * w + min_x) * 4
        dst_row = (y * cw) * 4
        cropped[dst_row:dst_row + cw * 4] = out[src_row:src_row + cw * 4]

    return cw, ch, cropped


def blend_pixel(buf, cw, ch, x, y, r, g, b, a):
    if x < 0 or x >= cw or y < 0 or y >= ch or a <= 0:
        return
    idx = (y * cw + x) * 4
    sa = min(1.0, a / 255.0)
    da = buf[idx + 3] / 255.0
    out_a = sa + da * (1.0 - sa)
    if out_a <= 1e-5:
        return
    buf[idx] = int((r * sa + buf[idx] * da * (1.0 - sa)) / out_a + 0.5)
    buf[idx + 1] = int((g * sa + buf[idx + 1] * da * (1.0 - sa)) / out_a + 0.5)
    buf[idx + 2] = int((b * sa + buf[idx + 2] * da * (1.0 - sa)) / out_a + 0.5)
    buf[idx + 3] = int(out_a * 255.0 + 0.5)


def convert_sitting_to_standing_pose(cw, ch, src_rgba, pose="stand"):
    """
    Takes the authentic extracted Mousie Pi and converts the lower body from
    'sitting holding cheese' into 'standing upright on two legs without cheese',
    while preserving 100% of the original head, ears, face, fur texture, and tail!
    """
    out = bytearray(src_rgba)

    # Center of body X is around 0.468 * cw (since tail is on the right)
    bx = cw * 0.468
    by_belly = ch * 0.675

    # Measure exact left & right body edges at y_ref = int(ch * 0.63) so the lower-body
    # contour continues with C1 smoothness and ZERO horizontal step!
    y_ref = int(ch * 0.63)
    left_ref = int(bx - cw * 0.335)
    right_ref = int(bx + cw * 0.335)
    for x in range(int(bx), 0, -1):
        if out[(y_ref * cw + x) * 4 + 3] > 128:
            left_ref = x
        else:
            break
    for x in range(int(bx), cw):
        if out[(y_ref * cw + x) * 4 + 3] > 128:
            right_ref = x
        else:
            break

    bx = 0.5 * (left_ref + right_ref)
    half_w_ref = 0.5 * (right_ref - left_ref)
    y_bot = ch * 0.855

    # 1. Smoothly taper the lower body from y_ref down to y_bot, erasing the splayed sitting feet
    #    while preserving the pink tail on the right and extending the tail base into the hip!
    for y in range(y_ref, ch):
        t_y = max(0.0, (y - y_ref) / (y_bot - y_ref))
        # Smooth super-ellipse taper starting with zero slope at y = y_ref
        if t_y < 1.0:
            max_dx = half_w_ref * ((1.0 - t_y ** 2.1) ** 0.52)
        else:
            max_dx = 0.0

        for x in range(cw):
            idx = (y * cw + x) * 4
            if out[idx + 3] == 0:
                continue
            r, g, b = out[idx], out[idx + 1], out[idx + 2]
            dx_abs = abs(x - bx)

            # Keep the pink tail on the right (x > bx + half_w_ref * 0.72 and y < ch * 0.742)
            is_tail = (x > bx + half_w_ref * 0.72) and (y < ch * 0.742) and (r > b + 12)
            if is_tail:
                continue

            if dx_abs > max_dx:
                if max_dx > 0 and dx_abs < max_dx + 6.0:
                    fade = max(0.0, (max_dx + 6.0 - dx_abs) / 6.0)
                    out[idx + 3] = int(out[idx + 3] * fade)
                else:
                    out[idx] = out[idx + 1] = out[idx + 2] = out[idx + 3] = 0

    # Connect the base of the tail smoothly behind the right hip so there is no gap where the sitting foot was
    for i in range(40):
        t = i / 39.0
        tx = bx + half_w_ref * (0.76 + 0.25 * t)
        ty = ch * (0.748 - 0.036 * t - 0.008 * math.sin(t * math.pi))
        rad = cw * (0.020 * (1.0 - 0.20 * t))
        for py in range(int(ty - rad - 3), int(ty + rad + 4)):
            for px in range(int(tx - rad - 3), int(tx + rad + 4)):
                if 0 <= px < cw and 0 <= py < ch:
                    # Only paint behind the torso silhouette so the tail emerges from behind the body
                    if out[(py * cw + px) * 4 + 3] > 220 and px < bx + half_w_ref * 0.90:
                        continue
                    d = math.hypot(px - tx, py - ty)
                    if d <= rad + 1.5:
                        a_f = max(0.0, min(1.0, (rad + 1.5 - d) / 2.0))
                        stripe = 0.5 + 0.5 * math.sin(t * 9.0)
                        tr = int(234 * (1 - stripe * 0.12))
                        tg = int(132 * (1 - stripe * 0.16))
                        tb = int(144 * (1 - stripe * 0.14))
                        blend_pixel(out, cw, ch, px, py, tr, tg, tb, a_f * 255.0)

    # 2. Paint over the cheese & inward hands on the belly with Mousie Pi's authentic
    #    sky-blue fur + soft light-blue oval tummy patch!
    for y in range(int(ch * 0.555), int(y_bot + 6)):
        t_y = max(0.0, min(1.0, (y - y_ref) / max(1.0, y_bot - y_ref)))
        row_half_w = half_w_ref * ((1.0 - (t_y ** 2.1) * 0.98) ** 0.52) if y >= y_ref else half_w_ref
        for x in range(int(bx - half_w_ref - 4), int(bx + half_w_ref + 5)):
            idx = (y * cw + x) * 4
            if out[idx + 3] < 10:
                continue

            nx = (x - bx) / max(1.0, row_half_w)
            ny = (y - ch * 0.60) / (ch * 0.255)
            if abs(nx) > 1.02:
                continue

            # Smooth blend mask covering the cheese & inward-reaching paws
            wy = max(0.0, min(1.0, (y - ch * 0.562) / (ch * 0.035)))
            wx = max(0.0, min(1.0, (1.0 - abs(nx)) / 0.16))
            mask = wy * wx

            if mask <= 0.0:
                continue

            # Base sky-blue fur shading matching the exact gradients of mousie_pi_source.png
            edge_shade = min(1.0, (nx * nx * 0.82 + max(0.0, ny) * 0.42))
            base_r = 92.0 * (1.0 - edge_shade) + 60.0 * edge_shade
            base_g = 186.0 * (1.0 - edge_shade) + 148.0 * edge_shade
            base_b = 233.0 * (1.0 - edge_shade) + 203.0 * edge_shade

            # Soft lighter sky-blue oval tummy patch in the center of the belly
            tummy_dx = (x - bx) / (cw * 0.145)
            tummy_dy = (y - ch * 0.695) / (ch * 0.115)
            tummy_d = math.sqrt(tummy_dx * tummy_dx + tummy_dy * tummy_dy)
            if tummy_d < 1.0:
                t_fade = max(0.0, min(1.0, (1.0 - tummy_d) / 0.22))
                base_r = base_r * (1.0 - t_fade * 0.50) + 146.0 * (t_fade * 0.50)
                base_g = base_g * (1.0 - t_fade * 0.50) + 214.0 * (t_fade * 0.50)
                base_b = base_b * (1.0 - t_fade * 0.50) + 246.0 * (t_fade * 0.50)

            out[idx] = int(out[idx] * (1.0 - mask) + base_r * mask + 0.5)
            out[idx + 1] = int(out[idx + 1] * (1.0 - mask) + base_g * mask + 0.5)
            out[idx + 2] = int(out[idx + 2] * (1.0 - mask) + base_b * mask + 0.5)

    # 3. Pose parameters for standing / running legs & swinging arms
    left_leg_dx, left_leg_dy, left_foot_ang = 0.0, 0.0, 0.10
    right_leg_dx, right_leg_dy, right_foot_ang = 0.0, 0.0, -0.10
    left_arm_dy, left_arm_ang = 0.0, 0.32
    right_arm_dy, right_arm_ang = 0.0, -0.32

    if pose == "walk1":
        left_leg_dx, left_leg_dy, left_foot_ang = -8.0, -24.0, 0.35
        right_leg_dx, right_leg_dy, right_foot_ang = 8.0, 10.0, -0.22
        left_arm_dy, left_arm_ang = 10.0, 0.48
        right_arm_dy, right_arm_ang = -14.0, -0.55
    elif pose == "walk2":
        left_leg_dx, left_leg_dy, left_foot_ang = 8.0, 10.0, 0.22
        right_leg_dx, right_leg_dy, right_foot_ang = -8.0, -24.0, -0.35
        left_arm_dy, left_arm_ang = -14.0, 0.55
        right_arm_dy, right_arm_ang = 10.0, -0.48
    elif pose == "jump":
        left_leg_dx, left_leg_dy, left_foot_ang = -6.0, -18.0, 0.42
        right_leg_dx, right_leg_dy, right_foot_ang = 6.0, -18.0, -0.42
        left_arm_dy, left_arm_ang = -24.0, 0.85
        right_arm_dy, right_arm_ang = -24.0, -0.85
    elif pose == "hurt":
        left_leg_dx, left_leg_dy, left_foot_ang = -10.0, -12.0, 0.30
        right_leg_dx, right_leg_dy, right_foot_ang = 10.0, -8.0, -0.30
        left_arm_dy, left_arm_ang = -16.0, 0.70
        right_arm_dy, right_arm_ang = -16.0, -0.70

    # Helper to draw a smooth anti-aliased rotated ellipse
    def draw_aa_ellipse(cx, cy, rx, ry, angle_rad, color_fn):
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        rmax = int(max(rx, ry) + 4)
        y0, y1 = max(0, int(cy - rmax)), min(ch - 1, int(cy + rmax))
        x0, x1 = max(0, int(cx - rmax)), min(cw - 1, int(cx + rmax))
        for py in range(y0, y1 + 1):
            for px in range(x0, x1 + 1):
                dx = px - cx
                dy = py - cy
                lx = (dx * cos_a + dy * sin_a) / rx
                ly = (-dx * sin_a + dy * cos_a) / ry
                d = math.sqrt(lx * lx + ly * ly)
                if d <= 1.04:
                    alpha_f = max(0.0, min(1.0, (1.04 - d) / 0.07))
                    r, g, b, a_mult = color_fn(lx, ly, d)
                    blend_pixel(out, cw, ch, px, py, r, g, b, alpha_f * a_mult * 255.0)

    # 4. Draw two upright standing legs + flat-bottomed standing pink paws underneath the torso!
    def draw_standing_leg(hip_x, hip_y, foot_dx, foot_dy, foot_ang, is_left):
        # Upright blue leg connecting torso to standing foot
        leg_cx = hip_x + foot_dx * 0.65
        leg_cy = hip_y + ch * 0.022 + foot_dy * 0.78
        leg_rx = cw * 0.062
        leg_ry = ch * 0.066

        def leg_color(lx, ly, d):
            shade = min(1.0, max(0.0, lx * (0.4 if is_left else -0.4) + 0.5))
            r = 56.0 + shade * 28.0
            g = 144.0 + shade * 32.0
            b = 198.0 + shade * 28.0
            if d > 0.85:
                rim = (d - 0.85) / 0.15
                r = r * (1.0 - rim * 0.35) + 42.0 * (rim * 0.35)
                g = g * (1.0 - rim * 0.35) + 115.0 * (rim * 0.35)
                b = b * (1.0 - rim * 0.35) + 168.0 * (rim * 0.35)
            return r, g, b, 1.0

        draw_aa_ellipse(leg_cx, leg_cy, leg_rx, leg_ry, foot_ang * 0.25, leg_color)

        # Standing pink foot (dome-shaped upper foot with flat sole resting on the ground!)
        fx = hip_x + ( -cw * 0.015 if is_left else cw * 0.015 ) + foot_dx
        fy = hip_y + ch * 0.082 + foot_dy
        frx = cw * 0.078
        fry = ch * 0.036

        cos_a = math.cos(foot_ang * 0.35)
        sin_a = math.sin(foot_ang * 0.35)
        rmax = int(max(frx, fry) + 6)
        for py in range(max(0, int(fy - rmax)), min(ch - 1, int(fy + rmax))):
            for px in range(max(0, int(fx - rmax)), min(cw - 1, int(fx + rmax))):
                dx = px - fx
                dy = py - fy
                lx = (dx * cos_a + dy * sin_a) / frx
                ly = (-dx * sin_a + dy * cos_a) / fry
                # Dome top (ly < 0) + flatter sole bottom (ly > 0 compressed by 1.45x)
                eff_ly = ly * (0.95 if ly < 0 else 1.55)
                d = math.sqrt(lx * lx + eff_ly * eff_ly)
                if d <= 1.04:
                    alpha_f = max(0.0, min(1.0, (1.04 - d) / 0.08))
                    # Pink standing foot with darker pink sole rim & toe highlight
                    if ly > 0.22:
                        r, g, b = 219.0, 109.0, 122.0
                    else:
                        r, g, b = 242.0, 145.0, 155.0
                        if ly < -0.20:
                            hl = min(1.0, (-0.20 - ly) * 0.9) * max(0.0, 1.0 - d)
                            r = min(255.0, r + hl * 20.0)
                            g = min(255.0, g + hl * 24.0)
                            b = min(255.0, b + hl * 24.0)
                    blend_pixel(out, cw, ch, px, py, r, g, b, alpha_f * 255.0)

    draw_standing_leg(bx - cw * 0.118, ch * 0.822, left_leg_dx, left_leg_dy, left_foot_ang, True)
    draw_standing_leg(bx + cw * 0.118, ch * 0.822, right_leg_dx, right_leg_dy, right_foot_ang, False)

    # 5. Draw cute rounded sky-blue paws at the sides of the torso (without cheese!)
    def draw_side_paw(px_c, py_c, ang, is_left):
        prx = cw * 0.068
        pry = ch * 0.044

        def paw_color(lx, ly, d):
            # Sky-blue paw with glossy highlight & darker-blue outline matching original art
            r, g, b = 86.0, 178.0, 228.0
            # Glossy white-cyan highlight in center-bottom of paw
            hd = math.sqrt((lx * 1.2) ** 2 + ((ly - 0.1) * 1.4) ** 2)
            if hd < 0.68:
                hl = (1.0 - hd / 0.68) ** 1.6 * 0.55
                r = r * (1.0 - hl) + 225.0 * hl
                g = g * (1.0 - hl) + 248.0 * hl
                b = b * (1.0 - hl) + 255.0 * hl
            # Darker blue outline around the paw tip/bottom
            if d > 0.82:
                rim = (d - 0.82) / 0.18
                r = r * (1.0 - rim * 0.55) + 42.0 * (rim * 0.55)
                g = g * (1.0 - rim * 0.55) + 122.0 * (rim * 0.55)
                b = b * (1.0 - rim * 0.55) + 175.0 * (rim * 0.55)
            return r, g, b, 1.0

        draw_aa_ellipse(px_c, py_c, prx, pry, ang, paw_color)

    draw_side_paw(bx - cw * 0.215, by_belly + left_arm_dy, left_arm_ang, True)
    draw_side_paw(bx + cw * 0.215, by_belly + right_arm_dy, right_arm_ang, False)

    return out


def make_pu_variant(cw, ch, pi_rgba):
    """
    Creates Мышонок Пу by shifting ONLY the blue fur pixels to a warm sunny golden-amber/coral
    palette while preserving the exact shading, eyes, pink inner ears/nose/feet/tail!
    """
    out = bytearray(pi_rgba)
    for y in range(ch):
        for x in range(cw):
            i = (y * cw + x) * 4
            a = out[i + 3]
            if a == 0:
                continue
            r, g, b = out[i], out[i + 1], out[i + 2]
            if b > r + 18 and g > r + 4:
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                blue_strength = min(1.0, (b - r) / 85.0)
                tr = min(255, int(lum * 1.32 + 22))
                tg = min(255, int(lum * 0.88 + 4))
                tb = max(0, min(255, int(lum * 0.48 - 10)))
                out[i] = int(r * (1.0 - blue_strength) + tr * blue_strength)
                out[i + 1] = int(g * (1.0 - blue_strength) + tg * blue_strength)
                out[i + 2] = int(b * (1.0 - blue_strength) + tb * blue_strength)
            elif (0.44 * ch <= y <= 0.58 * ch) and r > 135 and b > 145:
                out[i] = min(255, r + 24)
                out[i + 1] = int(g * 0.88)
                out[i + 2] = int(b * 0.78)
    return out


def sample_bilinear(w, h, rgba, sx, sy):
    if sx < 0 or sx >= w - 1 or sy < 0 or sy >= h - 1:
        return (0, 0, 0, 0)
    x0 = int(sx)
    y0 = int(sy)
    fx = sx - x0
    fy = sy - y0
    w00 = (1.0 - fx) * (1.0 - fy)
    w10 = fx * (1.0 - fy)
    w01 = (1.0 - fx) * fy
    w11 = fx * fy

    i00 = (y0 * w + x0) * 4
    i10 = i00 + 4
    i01 = ((y0 + 1) * w + x0) * 4
    i11 = i01 + 4

    a00, a10, a01, a11 = rgba[i00 + 3], rgba[i10 + 3], rgba[i01 + 3], rgba[i11 + 3]
    a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11
    if a < 1.0:
        return (0, 0, 0, 0)

    aw00 = a00 * w00
    aw10 = a10 * w10
    aw01 = a01 * w01
    aw11 = a11 * w11
    a_sum = aw00 + aw10 + aw01 + aw11
    r = (rgba[i00] * aw00 + rgba[i10] * aw10 + rgba[i01] * aw01 + rgba[i11] * aw11) / a_sum
    g = (rgba[i00 + 1] * aw00 + rgba[i10 + 1] * aw10 + rgba[i01 + 1] * aw01 + rgba[i11 + 1] * aw11) / a_sum
    b = (rgba[i00 + 2] * aw00 + rgba[i10 + 2] * aw10 + rgba[i01 + 2] * aw01 + rgba[i11 + 2] * aw11) / a_sum
    return (int(r + 0.5), int(g + 0.5), int(b + 0.5), int(a + 0.5))


def warp_pose_and_downsample(cw, ch, src_rgba, pose, out_w=154, out_h=176):
    """
    Applies subtle whole-body bounce/tilt and ear/tail secondary motion, then downsamples
    to out_w x out_h (154x176 — matching the previous size the user liked).
    """
    out = bytearray(out_w * out_h * 4)
    cx = cw * 0.48
    cy = ch * 0.54

    tilt_rad = 0.0
    scale_x = 1.0
    scale_y = 1.0
    shift_y = 0.0
    ear_bob = 0.0
    tail_sway = 0.0

    if pose == "walk1":
        tilt_rad = math.radians(3.0)
        scale_x = 1.01
        scale_y = 0.99
        shift_y = -6.0
        ear_bob = 7.0
        tail_sway = 12.0
    elif pose == "walk2":
        tilt_rad = math.radians(-3.0)
        scale_x = 0.99
        scale_y = 1.01
        shift_y = -4.0
        ear_bob = -7.0
        tail_sway = -12.0
    elif pose == "jump":
        tilt_rad = math.radians(-2.0)
        scale_x = 0.96
        scale_y = 1.04
        shift_y = -14.0
        ear_bob = -12.0
        tail_sway = 16.0
    elif pose == "hurt":
        tilt_rad = math.radians(-6.5)
        scale_x = 1.04
        scale_y = 0.96
        shift_y = -6.0
        ear_bob = 10.0
        tail_sway = -16.0

    cos_t = math.cos(-tilt_rad)
    sin_t = math.sin(-tilt_rad)

    for oy in range(out_h):
        for ox in range(out_w):
            r_acc = g_acc = b_acc = a_acc = 0
            for sy_sub in (0.25, 0.75):
                for sx_sub in (0.25, 0.75):
                    nx = (ox + sx_sub) / out_w
                    ny = (oy + sy_sub) / out_h
                    px = nx * cw
                    py = ny * ch - shift_y

                    dx = (px - cx) / scale_x
                    dy = (py - cy) / scale_y
                    ux = cx + dx * cos_t - dy * sin_t
                    uy = cy + dx * sin_t + dy * cos_t

                    # Ears zone (smooth top falloff)
                    if uy < ch * 0.34:
                        w_ear = ((ch * 0.34 - uy) / (ch * 0.34)) ** 1.5
                        uy -= ear_bob * w_ear * (1.0 if ux < cx else -0.8)

                    # Tail zone
                    dtx = (ux - cw * 0.84) / (cw * 0.16)
                    dty = (uy - ch * 0.62) / (ch * 0.20)
                    w_tail = math.exp(-(dtx * dtx + dty * dty))
                    uy -= tail_sway * w_tail

                    r, g, b, a = sample_bilinear(cw, ch, src_rgba, ux, uy)
                    a_acc += a
                    r_acc += r * a
                    g_acc += g * a
                    b_acc += b * a

            oidx = (oy * out_w + ox) * 4
            if a_acc > 0:
                out[oidx] = min(255, int(r_acc / a_acc + 0.5))
                out[oidx + 1] = min(255, int(g_acc / a_acc + 0.5))
                out[oidx + 2] = min(255, int(b_acc / a_acc + 0.5))
                out[oidx + 3] = min(255, int(a_acc / 4.0 + 0.5))

    return out_w, out_h, bytes(out)


def main():
    w, h, src_rgba = read_png_rgba(SRC_PATH)
    cw, ch, pi_base = extract_clean_character(w, h, src_rgba)

    poses = ["stand", "ready", "walk1", "walk2", "jump", "hurt"]
    for pose in poses:
        pi_standing = convert_sitting_to_standing_pose(cw, ch, pi_base, pose)
        pu_standing = make_pu_variant(cw, ch, pi_standing)

        ow, oh, f1 = warp_pose_and_downsample(cw, ch, pi_standing, pose, out_w=154, out_h=176)
        write_png_rgba(os.path.join(OUT_DIR_1, f"bunny1_{pose}.png"), ow, oh, f1)

        ow, oh, f2 = warp_pose_and_downsample(cw, ch, pu_standing, pose, out_w=154, out_h=176)
        write_png_rgba(os.path.join(OUT_DIR_2, f"bunny2_{pose}.png"), ow, oh, f2)

    print(f"Generated {len(poses) * 2} standing Mousie Pi & Pu sprites ({ow}x{oh}) without cheese!")


if __name__ == "__main__":
    main()
