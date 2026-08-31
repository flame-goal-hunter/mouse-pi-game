// ============================================
// menuAudio — tiny UI sound player for the standalone HTML menu pages
// (no Phaser scene/loader there, so it can't reuse AudioManager). Mirrors
// AudioManager's ui-channel volume math: sample vol (SoundMap) x prefs.ui x
// prefs.master, silenced by prefs.muted. One <audio> per sound, cloned on
// rapid repeats so overlapping taps don't cut each other off.
// ============================================
import { SFX_FILES } from './SoundMap.js';
import { Progress } from '../storage/ProgressStore.js';

const SOUNDS = {
    click: 'ui_click',
    back:  'ui_back',
    open:  'ui_open',
    buy:   'ui_buy',
    deny:  'ui_deny'
};

const MAX_CLONES = 4; // per sound, on top of the base node

const _entries = {}; // name -> { el, fileKey, clones: Audio[] }

function safePrefs() {
    try {
        const p = Progress.getAudioPrefs();
        if (p && typeof p === 'object') return p;
    } catch (e) {}
    return null;
}

function isMuted() {
    const p = safePrefs();
    return !!(p && p.muted);
}

function volumeFor(fileKey) {
    const entry = SFX_FILES[fileKey];
    const base = entry ? entry[1] : 1;
    const p = safePrefs();
    const master = (p && typeof p.master === 'number') ? p.master : 1;
    const ui = (p && typeof p.ui === 'number') ? p.ui : 0.8;
    return Math.max(0, Math.min(1, base * master * ui));
}

function getEntry(name) {
    const fileKey = SOUNDS[name];
    if (!fileKey) return null;
    let entry = _entries[name];
    if (!entry) {
        const el = new Audio(`assets/audio/sfx/${fileKey}.ogg`);
        el.preload = 'auto';
        entry = _entries[name] = { el, fileKey, clones: [] };
    }
    return entry;
}

function pickNode(entry) {
    if (entry.el.paused || entry.el.ended) return entry.el;
    const idle = entry.clones.find(c => c.paused || c.ended);
    if (idle) return idle;
    if (entry.clones.length < MAX_CLONES) {
        const clone = entry.el.cloneNode();
        entry.clones.push(clone);
        return clone;
    }
    return null; // every node busy — drop the play rather than pile up more
}

export function playMenuSound(name) {
    if (isMuted()) return;
    const entry = getEntry(name);
    if (!entry) return;
    const node = pickNode(entry);
    if (!node) return;
    node.volume = volumeFor(entry.fileKey);
    try { node.currentTime = 0; } catch (e) {}
    try {
        const p = node.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
}
