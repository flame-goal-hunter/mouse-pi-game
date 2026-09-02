// ============================================
// menuAudio — tiny UI sound player for the standalone HTML menu pages
// (no Phaser scene/loader there, so it can't reuse AudioManager). Mirrors
// AudioManager's ui-channel volume math: sample vol (SoundMap) x prefs.ui x
// prefs.master, silenced by prefs.muted. One <audio> per sound, cloned on
// rapid repeats so overlapping taps don't cut each other off.
// ============================================
import { SFX_FILES, BGM_FILES } from './SoundMap.js';
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

// ============================================
// Menu music — the castle theme under the menu, same track the kitchen floors use.
// Browsers block autoplay, so it starts on the player's first interaction and
// obeys the same music/master/mute preferences as the game.
// ============================================
const BGM_KEY = 'throne';   // 'hall' is the kitchen floor's track — too familiar for the menu
let _bgm = null;
let _fade = null;
let _started = false;

function bgmVolume() {
    const p = safePrefs();
    if (p && p.muted) return 0;
    // Missing prefs must mean "use the defaults", not "stay silent" — the old code
    // returned 0 whenever localStorage was unavailable, which is silence forever.
    const base = (BGM_FILES[BGM_KEY] && BGM_FILES[BGM_KEY][1]) || 0.34;
    const music = (p && typeof p.music === 'number') ? p.music : 0.6;
    const master = (p && typeof p.master === 'number') ? p.master : 1;
    return Math.max(0, Math.min(1, base * music * master));
}

function fadeTo(target) {
    if (_fade) clearInterval(_fade);
    const step = Math.max(0.005, target / 20);
    _fade = setInterval(() => {                       // ~1 s fade-in, no sudden blast
        const v = Math.min(target, (_bgm.volume || 0) + step);
        _bgm.volume = v;
        if (v >= target) { clearInterval(_fade); _fade = null; }
    }, 50);
}

// Mirrors AudioManager._startEl: try straight away, fall back to a gesture only if the
// browser actually refuses.
export function startMenuMusic() {
    const target = bgmVolume();
    if (!_bgm) {
        const file = (BGM_FILES[BGM_KEY] && BGM_FILES[BGM_KEY][0]) || BGM_KEY;
        _bgm = new Audio(`assets/audio/bgm/${file}.ogg`);
        _bgm.loop = true;
        _bgm.preload = 'auto';
        _bgm.volume = 0;
    }
    if (target <= 0) { try { _bgm.pause(); } catch (e) {} return Promise.resolve(false); }
    let pr = null;
    try { pr = _bgm.play(); } catch (e) { return Promise.resolve(false); }
    if (!pr || typeof pr.then !== 'function') { _started = true; fadeTo(target); return Promise.resolve(true); }
    return pr.then(() => { _started = true; fadeTo(target); return true; })
             .catch(() => false);
}

export function refreshMenuMusicVolume() {
    if (!_bgm) return;
    const target = bgmVolume();
    if (_fade) { clearInterval(_fade); _fade = null; }
    _bgm.volume = target;
    if (target <= 0) { try { _bgm.pause(); } catch (e) {} }
    else if (_bgm.paused) startMenuMusic();
}

if (typeof window !== 'undefined') {
    const attempt = () => startMenuMusic().catch(() => false);

    // Capture phase on both window and document, and every event that can carry a
    // user gesture: a listener on window in the bubble phase is lost the moment any
    // handler on the page calls stopPropagation.
    const EVENTS = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'click', 'keydown'];
    const kick = () => { if (!_started) attempt(); };
    for (const ev of EVENTS) {
        window.addEventListener(ev, kick, true);
        document.addEventListener(ev, kick, true);
    }

    // Watchdog: whatever refused the earlier attempts — a blocked autoplay, an audio
    // focus loss, a WebView pausing on resume — the next tick picks it back up. It
    // costs one paused check a second and stops asking once the track is running.
    let ticks = 0;
    const watchdog = setInterval(() => {
        if (bgmVolume() <= 0) return;                 // muted on purpose: leave it alone
        if (_bgm && !_bgm.paused) { _started = true; return; }
        if (++ticks > 600) { clearInterval(watchdog); return; }   // give up after 10 min
        attempt();
    }, 1000);

    attempt();
    window.addEventListener('pagehide', () => { if (_bgm) { try { _bgm.pause(); } catch (e) {} } });
    // Coming back to the menu from the game: resume rather than stay silent.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _bgm && _bgm.paused) attempt();
    });
}
