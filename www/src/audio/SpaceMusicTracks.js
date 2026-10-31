// ============================================================================
// SpaceMusicTracks.js — Коллекция из 4 фоновых космических мелодий Мышонка Пи
// 1) space_chill  — 🌌 Звёздный полёт (базовая мелодия Космоса)
// 2) classic_menu — 🐭 Классика Мышонка Пи (оригинальная мелодия старого меню + синт)
// 3) turbo_synth  — 🚀 Турбо-Галактика (энергичный 80s Synthwave / Chiptune)
// 4) cheese_disco — 🧀 Сырная Дискотека (весёлый Funky / Cosmic Disco)
// ============================================================================

export const SPACE_MUSIC_TRACKS = [
    { id: 'space_chill',  label: '🌌 Звёздный полёт',       stepMs: 420 },
    { id: 'classic_menu', label: '🐭 Классика Мышонка Пи',  stepMs: 240, audioSrc: 'assets/sounds/KleptoLindaCavernsA_Loopable.ogg', rate: 1.1, vol: 0.38 },
    { id: 'turbo_synth',  label: '🚀 Турбо-Галактика',      stepMs: 175 },
    { id: 'cheese_disco', label: '🧀 Сырная Дискотека',     stepMs: 210 }
];

export const PENTA = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00];
export const HOME_NOTES = [523.25, 659.25, 783.99, 659.25, 587.33, 783.99, 659.25, 523.25, 440.00, 523.25, 659.25, 587.33];

const CHILL_CHORDS = [
    [130.81, 196.00, 246.94, 329.63], // Cmaj7
    [110.00, 164.81, 220.00, 261.63], // Am7
    [174.61, 220.00, 261.63, 349.23], // Fmaj7
    [146.83, 196.00, 246.94, 293.66]  // G6
];

// Ноты для "Классики Мышонка Пи" (озорной мотив в духе KleptoLindaCaverns / аркадного меню)
const CLASSIC_BASS = [110.00, 0, 164.81, 0, 130.81, 0, 196.00, 0, 146.83, 0, 220.00, 0, 164.81, 146.83, 130.81, 123.47];
const CLASSIC_LEAD = [
    440.00, 523.25, 659.25, 587.33, 523.25, 0, 392.00, 440.00,
    523.25, 659.25, 783.99, 659.25, 587.33, 523.25, 493.88, 0,
    440.00, 523.25, 659.25, 880.00, 783.99, 659.25, 523.25, 587.33,
    659.25, 587.33, 523.25, 493.88, 440.00, 0, 329.63, 0
];

// Ноты для "Турбо-Галактики" (80s Synthwave Am - F - C - G)
const TURBO_ROOTS = [110.00, 87.31, 130.81, 98.00];
const TURBO_ARP = [
    [220.00, 261.63, 329.63, 440.00, 523.25, 440.00, 329.63, 261.63],
    [174.61, 220.00, 261.63, 349.23, 440.00, 349.23, 261.63, 220.00],
    [261.63, 329.63, 392.00, 523.25, 659.25, 523.25, 392.00, 329.63],
    [196.00, 246.94, 293.66, 392.00, 493.88, 392.00, 293.66, 246.94]
];
const TURBO_MELODY = [
    880.00, 0, 783.99, 659.25, 0, 523.25, 587.33, 659.25,
    698.46, 0, 659.25, 523.25, 0, 440.00, 523.25, 587.33,
    783.99, 0, 659.25, 523.25, 659.25, 0, 880.00, 0,
    783.99, 698.46, 659.25, 587.33, 523.25, 0, 493.88, 0
];

// Ноты для "Сырной Дискотеки" (Funky Cosmic Disco C6 - F9 - Dm7 - G13)
const DISCO_BASS = [
    130.81, 261.63, 0, 196.00, 220.00, 0, 246.94, 261.63,
    174.61, 349.23, 0, 261.63, 293.66, 0, 329.63, 349.23,
    146.83, 293.66, 0, 220.00, 261.63, 0, 196.00, 246.94,
    196.00, 392.00, 329.63, 293.66, 261.63, 246.94, 220.00, 196.00
];
const DISCO_BELLS = [
    523.25, 659.25, 783.99, 1046.50, 0, 880.00, 783.99, 659.25,
    698.46, 880.00, 1046.50, 0, 880.00, 783.99, 659.25, 523.25,
    587.33, 698.46, 880.00, 1174.66, 0, 1046.50, 880.00, 698.46,
    783.99, 987.77, 1174.66, 987.77, 783.99, 659.25, 587.33, 0
];
const DISCO_STABS = [
    [261.63, 329.63, 392.00, 440.00],
    [220.00, 261.63, 349.23, 440.00],
    [293.66, 349.23, 440.00, 523.25],
    [246.94, 293.66, 392.00, 493.88]
];

export function getTrackMeta(trackId) {
    return SPACE_MUSIC_TRACKS.find(t => t.id === trackId) || SPACE_MUSIC_TRACKS[0];
}

export function playSpaceTrackStep(state, tone, audioPlaying = false) {
    const s = state.stepIdx++;
    const id = state.trackId || 'space_chill';

    if (id === 'space_chill') {
        if (s % 8 === 0) {
            const chord = CHILL_CHORDS[state.chordIdx++ % CHILL_CHORDS.length];
            chord.forEach(freq => tone(freq, freq * 1.002, 3.2, 'triangle', 0.036, true));
        }
        if (s % 3 === 0 && Math.random() < 0.72) {
            const note = PENTA[Math.floor(Math.random() * PENTA.length)];
            tone(note, note, 0.65, 'sine', 0.042, true);
        }
        if (state.flightEnergy > 0.18 && s % 2 === 0) {
            const root = CHILL_CHORDS[(state.chordIdx - 1 + CHILL_CHORDS.length) % CHILL_CHORDS.length][0];
            tone(root * 0.5, root * 0.5, 0.24, 'triangle', 0.075 * state.flightEnergy, false);
        }
        return;
    }

    if (id === 'classic_menu') {
        // Если играет оригинальный KleptoLindaCavernsA_Loopable.ogg, не перекрываем его синтезатором
        if (audioPlaying) return;
        const bFreq = CLASSIC_BASS[s % CLASSIC_BASS.length];
        if (bFreq > 0) tone(bFreq, bFreq * 0.99, 0.22, 'triangle', 0.065, false);
        const lFreq = CLASSIC_LEAD[s % CLASSIC_LEAD.length];
        if (lFreq > 0) tone(lFreq, lFreq * 1.003, 0.21, 'triangle', 0.052, true);
        if (s % 4 === 0) tone(110, 42, 0.11, 'sine', 0.055, false);
        return;
    }

    if (id === 'turbo_synth') {
        const bar = Math.floor(s / 8) % TURBO_ROOTS.length;
        const root = TURBO_ROOTS[bar];
        const bassNote = (s % 2 === 0) ? root : root * 2;
        tone(bassNote, bassNote * 0.98, 0.14, 'sawtooth', 0.05, false);
        const arp = TURBO_ARP[bar][s % 8];
        tone(arp, arp, 0.16, 'triangle', 0.042, true);
        const mel = TURBO_MELODY[s % TURBO_MELODY.length];
        if (mel > 0 && s % 2 === 0) tone(mel, mel * 1.004, 0.3, 'sine', 0.046, true);
        if (s % 4 === 0) tone(135, 38, 0.12, 'sine', 0.075, false);
        else if (s % 4 === 2) tone(320, 120, 0.08, 'triangle', 0.045, true);
        return;
    }

    if (id === 'cheese_disco') {
        const bFreq = DISCO_BASS[s % DISCO_BASS.length];
        if (bFreq > 0) tone(bFreq, bFreq * 1.02, 0.17, 'triangle', 0.068, false);
        const bell = DISCO_BELLS[s % DISCO_BELLS.length];
        if (bell > 0) tone(bell, bell, 0.24, 'sine', 0.045, true);
        if (s % 8 === 2 || s % 8 === 6) {
            const stab = DISCO_STABS[Math.floor(s / 8) % DISCO_STABS.length];
            stab.forEach(f => tone(f, f, 0.18, 'triangle', 0.026, true));
        }
        if (s % 2 === 0) tone(125, 44, 0.1, 'sine', 0.065, false);
    }
}
