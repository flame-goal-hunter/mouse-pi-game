#!/usr/bin/env python3
"""
Generates brand-new, juicy cartoon & TF2-inspired audio assets for Snowball Mode:
  1. www/assets/sounds/snowball-arena-bgm.wav — 132 BPM TF2/Cartoon Brass-Funk Battle Loop
  2. www/assets/sounds/hook-fired.wav         — Pneumatic Grapple Launcher + Rope Zip
  3. www/assets/sounds/hook-attached.wav      — Crisp Steel Claw Latch + Ice Ring + Rope Twang
  4. www/assets/sounds/snowball-shot.wav      — Punchy Cartoon Snowball Throw Whoosh-Pop
  5. www/assets/sounds/snowball-hit.wav       — Crunchy Snow Impact Splat
  6. www/assets/sounds/jump-cartoon.wav       — Bouncy Cartoon Boing-Hop
"""

import math
import os
import random
import struct
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOUNDS_DIR = os.path.join(ROOT, "www", "assets", "sounds")


def save_wav(path, samples, sr=22050):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = bytearray()
    for s in samples:
        v = max(-1.0, min(1.0, s))
        pcm.extend(struct.pack("<h", int(v * 32767)))
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(pcm))


def midi_to_freq(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def gen_hook_fired(sr=22050):
    """Mechanical grapple gun launch: spring THUNK + fast rising cable ZIP + air whoosh."""
    dur = 0.34
    n = int(dur * sr)
    out = [0.0] * n
    rng = random.Random(42)
    phase = 0.0
    phase2 = 0.0

    for i in range(n):
        t = i / sr
        # 1. Initial mechanical spring plunger click/thunk (0..0.045s)
        thunk = 0.0
        if t < 0.05:
            env_t = math.exp(-t * 85.0)
            thunk = (math.sin(2 * math.pi * 190 * t) * 0.7 + (rng.random() * 2 - 1) * 0.5) * env_t

        # 2. Fast rising pneumatic rope zip + ratchet clicks (0.015..0.32s)
        zip_sig = 0.0
        if t >= 0.012:
            tz = t - 0.012
            # Rising pitch from 380Hz to 1650Hz with subtle ratchet modulation
            ratchet = 1.0 + 0.18 * math.sin(2 * math.pi * 68.0 * tz)
            freq = (380.0 + 3600.0 * (tz ** 0.75)) * ratchet
            phase += 2 * math.pi * freq / sr
            phase2 += 2 * math.pi * (freq * 1.5) / sr
            env_z = math.sin(min(1.0, tz / 0.30) * math.pi) ** 0.7 * math.exp(-tz * 4.5)
            zip_sig = (0.55 * math.sin(phase) + 0.30 * math.sin(phase2)) * env_z

        # 3. Cord air whoosh
        whoosh_env = math.sin(min(1.0, t / dur) * math.pi) * math.exp(-t * 5.0)
        whoosh = (rng.random() * 2 - 1) * 0.22 * whoosh_env

        out[i] = (thunk * 0.85 + zip_sig * 0.75 + whoosh) * 0.85
    return out


def gen_hook_attached(sr=22050):
    """Crisp metallic grapple claw lock + icy crystal chime + taut rope twang."""
    dur = 0.28
    n = int(dur * sr)
    out = [0.0] * n
    rng = random.Random(101)
    twang_phase = 0.0

    for i in range(n):
        t = i / sr
        # 1. Double metallic latch clink-lock (t=0 and t=0.028s)
        clink1 = math.exp(-t * 95.0) * (
            0.5 * math.sin(2 * math.pi * 1420 * t)
            + 0.4 * math.sin(2 * math.pi * 2380 * t)
            + 0.3 * (rng.random() * 2 - 1)
        )
        clink2 = 0.0
        if t >= 0.026:
            t2 = t - 0.026
            clink2 = math.exp(-t2 * 70.0) * (
                0.55 * math.sin(2 * math.pi * 1890 * t2)
                + 0.45 * math.sin(2 * math.pi * 3120 * t2)
            )

        # 2. Taut elastic rope twang (160Hz -> 290Hz pitch bend)
        twang_freq = 165.0 + 130.0 * (1.0 - math.exp(-t * 18.0))
        twang_phase += 2 * math.pi * twang_freq / sr
        twang_env = math.exp(-t * 14.0)
        twang = (0.6 * math.sin(twang_phase) + 0.25 * math.sin(twang_phase * 2)) * twang_env

        out[i] = (clink1 * 0.7 + clink2 * 0.8 + twang * 0.65) * 0.88
    return out


def gen_snowball_shot(sr=22050):
    """Juicy cartoon snowball throw: punchy pop + snappy swish."""
    dur = 0.22
    n = int(dur * sr)
    out = [0.0] * n
    rng = random.Random(77)
    phase = 0.0

    for i in range(n):
        t = i / sr
        # Cartoon cheek/catapult pop (pitch drops 520 -> 180Hz then rises 220 -> 680Hz)
        if t < 0.06:
            freq = 480.0 - 3000.0 * t
        else:
            freq = 260.0 + 2800.0 * (t - 0.06)
        phase += 2 * math.pi * max(120.0, freq) / sr
        pop_env = math.exp(-t * 16.0)
        pop = math.sin(phase) * pop_env * 0.65

        # Crisp snow-air swish
        swish_env = math.sin(min(1.0, t / 0.19) * math.pi) ** 1.2 * math.exp(-t * 7.0)
        noise = (rng.random() * 2 - 1) * swish_env * 0.45

        out[i] = (pop + noise) * 0.9
    return out


def gen_snowball_hit(sr=22050):
    """Crunchy cartoon snow splat + punchy bass thud."""
    dur = 0.26
    n = int(dur * sr)
    out = [0.0] * n
    rng = random.Random(303)
    phase = 0.0
    prev_n = 0.0

    for i in range(n):
        t = i / sr
        # Punchy cartoon impact thud (190Hz -> 55Hz)
        freq = 55.0 + 160.0 * math.exp(-t * 32.0)
        phase += 2 * math.pi * freq / sr
        thud = math.sin(phase) * math.exp(-t * 18.0) * 0.75

        # Crunchy snow-crystal burst
        raw = rng.random() * 2 - 1
        filt = 0.65 * raw + 0.35 * prev_n
        prev_n = raw
        crunch_env = math.exp(-t * 15.0) * (1.0 + 0.35 * math.sin(2 * math.pi * 55 * t))
        crunch = filt * crunch_env * 0.58

        out[i] = (thud + crunch) * 0.92
    return out


def gen_jump_cartoon(sr=22050):
    """Bouncy cartoon jump boing-hop."""
    dur = 0.21
    n = int(dur * sr)
    out = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / sr
        freq = 240.0 + 520.0 * ((t / dur) ** 0.7) + 25.0 * math.sin(2 * math.pi * 38 * t)
        phase += 2 * math.pi * freq / sr
        env = math.sin(min(1.0, t / 0.02) * math.pi * 0.5) * math.exp(-t * 11.0)
        out[i] = (0.7 * math.sin(phase) + 0.25 * math.sin(phase * 2.0)) * env * 0.85
    return out


def gen_snowball_bgm(sr=22050):
    """
    132 BPM Upbeat TF2 / Cartoon Spy-Funk & Brass Snowball Battle Theme!
    8 bars (32 beats, 128 sixteenth-note steps) seamless loop (~14.545 seconds).
    Completely distinct from the menu music!
    """
    bpm = 132.0
    step_sec = (60.0 / bpm) / 4.0  # 16th note duration = 0.113636s
    total_steps = 128              # 8 bars of 4/4
    total_samples = int(round(total_steps * step_sec * sr))
    out = [0.0] * total_samples
    rng = random.Random(1337)

    # Funky walking bassline in D Dorian / Minor Blues (MIDI notes per 16th step)
    # Bar 1-2: Dm7 groove, Bar 3-4: Gm7 -> C7, Bar 5-6: Dm7 -> Bb7, Bar 7-8: A7#9 turnaround!
    bass_pattern = [
        # Bar 1 (Dm)
        38, 0, 38, 41, 43, 0, 45, 0, 38, 0, 48, 45, 43, 41, 40, 38,
        # Bar 2 (Dm)
        38, 0, 38, 41, 43, 44, 45, 0, 50, 0, 48, 0, 45, 43, 41, 40,
        # Bar 3 (Gm)
        43, 0, 43, 46, 48, 0, 50, 0, 43, 0, 53, 50, 48, 46, 45, 43,
        # Bar 4 (C7)
        36, 0, 36, 40, 43, 0, 46, 0, 48, 0, 46, 43, 40, 38, 36, 37,
        # Bar 5 (Dm)
        38, 0, 38, 41, 43, 0, 45, 0, 38, 0, 48, 45, 43, 41, 40, 38,
        # Bar 6 (Bb7)
        46, 0, 46, 50, 53, 0, 50, 0, 48, 0, 48, 46, 45, 43, 41, 40,
        # Bar 7 (A7)
        45, 0, 45, 49, 52, 0, 55, 0, 54, 0, 52, 0, 49, 0, 45, 0,
        # Bar 8 (Turnaround)
        38, 0, 41, 0, 43, 0, 44, 0, 45, 0, 46, 0, 45, 43, 41, 40,
    ]

    # Catchy TF2-style Brass / Xylophone Lead Melody (MIDI notes, 0 = rest)
    lead_pattern = [
        # Bar 1
        62, 0, 65, 0, 69, 0, 67, 65, 62, 0, 0, 65, 67, 0, 69, 0,
        # Bar 2
        74, 0, 72, 0, 69, 0, 67, 65, 67, 0, 65, 0, 62, 0, 0, 0,
        # Bar 3
        67, 0, 70, 0, 74, 0, 72, 70, 67, 0, 0, 70, 72, 0, 74, 0,
        # Bar 4
        76, 0, 74, 0, 72, 0, 70, 0, 69, 0, 72, 0, 74, 0, 0, 0,
        # Bar 5
        62, 0, 65, 0, 69, 0, 74, 0, 72, 0, 69, 0, 67, 65, 62, 0,
        # Bar 6
        70, 0, 69, 0, 67, 0, 65, 0, 67, 0, 69, 0, 72, 0, 0, 0,
        # Bar 7
        69, 0, 73, 0, 76, 0, 74, 73, 76, 0, 74, 0, 73, 0, 69, 0,
        # Bar 8
        74, 0, 69, 0, 65, 0, 67, 0, 69, 0, 70, 0, 69, 0, 0, 0,
    ]

    # Syncopated Brass Chord Stabs (step indices within 16-step bar)
    stab_steps = {2, 6, 11, 14}
    bar_chords = [
        [57, 62, 65],  # Dm
        [57, 62, 65],  # Dm
        [58, 62, 67],  # Gm
        [60, 64, 67],  # C
        [57, 62, 65],  # Dm
        [58, 62, 65],  # Bb
        [57, 61, 67],  # A7
        [57, 62, 65],  # Dm
    ]

    for step in range(total_steps):
        start_idx = int(step * step_sec * sr)
        bar = step // 16
        step_in_bar = step % 16

        # 1. DRUMS: Kick on 0, 6, 8, 14; Snare on 4, 12; Hi-hat on every step
        if step_in_bar in (0, 6, 8, 14):
            k_len = int(0.11 * sr)
            k_phase = 0.0
            for j in range(k_len):
                if start_idx + j >= total_samples:
                    break
                t = j / sr
                kf = 52.0 + 115.0 * math.exp(-t * 42.0)
                k_phase += 2 * math.pi * kf / sr
                out[start_idx + j] += math.sin(k_phase) * math.exp(-t * 22.0) * 0.36

        if step_in_bar in (4, 12):
            s_len = int(0.12 * sr)
            for j in range(s_len):
                if start_idx + j >= total_samples:
                    break
                t = j / sr
                body = math.sin(2 * math.pi * 185.0 * t) * math.exp(-t * 35.0) * 0.45
                snap = (rng.random() * 2 - 1) * math.exp(-t * 26.0) * 0.55
                out[start_idx + j] += (body + snap) * 0.30

        # Crisp hi-hat
        hh_len = int(0.045 * sr)
        hh_vol = 0.11 if (step_in_bar % 2 == 0) else 0.06
        for j in range(hh_len):
            if start_idx + j >= total_samples:
                break
            t = j / sr
            out[start_idx + j] += (rng.random() * 2 - 1) * math.exp(-t * 65.0) * hh_vol

        # 2. FUNKY BASSLINE
        b_note = bass_pattern[step]
        if b_note > 0:
            bf = midi_to_freq(b_note)
            b_len = int(step_sec * 1.45 * sr)
            for j in range(b_len):
                if start_idx + j >= total_samples:
                    break
                t = j / sr
                env = math.sin(min(1.0, t / 0.008) * math.pi * 0.5) * math.exp(-t * 9.5)
                # Rich funky bass (fundamental + 2nd + 3rd harmonic)
                sig = (
                    0.65 * math.sin(2 * math.pi * bf * t)
                    + 0.25 * math.sin(2 * math.pi * bf * 2 * t)
                    + 0.10 * math.sin(2 * math.pi * bf * 3 * t)
                )
                out[start_idx + j] += sig * env * 0.28

        # 3. BRASS CHORD STABS
        if step_in_bar in stab_steps:
            chord = bar_chords[bar]
            c_len = int(step_sec * 0.95 * sr)
            for j in range(c_len):
                if start_idx + j >= total_samples:
                    break
                t = j / sr
                env = math.sin(min(1.0, t / 0.012) * math.pi * 0.5) * math.exp(-t * 14.0)
                csig = 0.0
                for mn in chord:
                    cf = midi_to_freq(mn)
                    csig += 0.55 * math.sin(2 * math.pi * cf * t) + 0.30 * math.sin(2 * math.pi * cf * 2 * t)
                out[start_idx + j] += (csig / len(chord)) * env * 0.18

        # 4. LEAD MELODY (Bright Cartoon Xylophone + Synth Brass)
        l_note = lead_pattern[step]
        if l_note > 0:
            lf = midi_to_freq(l_note)
            l_len = int(step_sec * 1.6 * sr)
            for j in range(l_len):
                if start_idx + j >= total_samples:
                    break
                t = j / sr
                env = math.sin(min(1.0, t / 0.006) * math.pi * 0.5) * math.exp(-t * 10.5)
                vibrato = 1.0 + 0.004 * math.sin(2 * math.pi * 6.5 * t)
                lsig = (
                    0.60 * math.sin(2 * math.pi * lf * vibrato * t)
                    + 0.25 * math.sin(2 * math.pi * lf * 2 * vibrato * t)
                    + 0.15 * math.sin(2 * math.pi * lf * 4 * t) * math.exp(-t * 35.0)
                )
                out[start_idx + j] += lsig * env * 0.24

    # Soft limiter so the mix is warm, loud, and never clips
    for i in range(total_samples):
        out[i] = math.tanh(out[i] * 1.25) * 0.88

    return out


def main():
    save_wav(os.path.join(SOUNDS_DIR, "hook-fired.wav"), gen_hook_fired())
    save_wav(os.path.join(SOUNDS_DIR, "hook-attached.wav"), gen_hook_attached())
    save_wav(os.path.join(SOUNDS_DIR, "snowball-shot.wav"), gen_snowball_shot())
    save_wav(os.path.join(SOUNDS_DIR, "snowball-hit.wav"), gen_snowball_hit())
    save_wav(os.path.join(SOUNDS_DIR, "jump-cartoon.wav"), gen_jump_cartoon())
    save_wav(os.path.join(SOUNDS_DIR, "snowball-arena-bgm.wav"), gen_snowball_bgm())
    print("Generated all new Snowball SFX & TF2/Cartoon Battle BGM in www/assets/sounds/!")


if __name__ == "__main__":
    main()

