// ============================================
// ProceduralSfx — Web Audio synthesis for UI + critical feedback sounds
// Zero asset cost. Used as fallback when no audio file is loaded.
// ============================================

export class ProceduralSfx {
    constructor() {
        this._ctx = null;
        this._masterGain = null;
        this._sfxGain = null;
        this._uiGain = null;
    }

    _ensureCtx() {
        if (this._ctx) return this._ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this._ctx = new AC();
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = 1.0;
        this._masterGain.connect(this._ctx.destination);
        this._sfxGain = this._ctx.createGain();
        this._sfxGain.gain.value = 0.85;
        this._sfxGain.connect(this._masterGain);
        this._uiGain = this._ctx.createGain();
        this._uiGain.gain.value = 0.80;
        this._uiGain.connect(this._masterGain);
        return this._ctx;
    }

    // Backgrounding the app has to stop the ambient bed too, not just the music.
    suspend() {
        const ctx = this._ctx;
        if (ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend();
    }

    resume() {
        const ctx = this._ensureCtx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }

    setVolume(channel, value) {
        this._ensureCtx();
        if (!this._ctx) return;
        const g = channel === 'master' ? this._masterGain
                : channel === 'sfx' ? this._sfxGain
                : channel === 'ui' ? this._uiGain : null;
        if (g) g.gain.value = Math.max(0, Math.min(1.5, value));
    }

    // === Helpers ===
    _envBeep(freq, dur, type = 'sine', gainCh = this._uiGain, vol = 0.25) {
        const ctx = this._ensureCtx();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        env.gain.value = 0;
        env.gain.linearRampToValueAtTime(vol, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(env).connect(gainCh);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }

    _envSweep(fromHz, toHz, dur, type = 'sawtooth', gainCh = this._sfxGain, vol = 0.2) {
        const ctx = this._ensureCtx();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(fromHz, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), now + dur);
        env.gain.value = 0;
        env.gain.linearRampToValueAtTime(vol, now + 0.01);
        env.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(env).connect(gainCh);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }

    _noiseBurst(dur, filterFreq = 3000, gainCh = this._sfxGain, vol = 0.18) {
        const ctx = this._ensureCtx();
        if (!ctx || ctx.state === 'suspended') return;
        const now = ctx.currentTime;
        const bufferSize = Math.floor(ctx.sampleRate * dur);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        const env = ctx.createGain();
        env.gain.value = 0;
        env.gain.linearRampToValueAtTime(vol, now + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, now + dur);
        src.connect(filter).connect(env).connect(gainCh);
        src.start(now);
        src.stop(now + dur + 0.02);
    }

    // === UI sounds ===
    uiClick()      { this._envBeep(880, 0.06, 'square', this._uiGain, 0.18); }
    uiBack()       { this._envBeep(440, 0.10, 'square', this._uiGain, 0.18); }
    uiBuy()        { this._envSweep(660, 1320, 0.18, 'triangle', this._uiGain, 0.20); }
    uiDeny()       { this._envSweep(440, 220, 0.20, 'sawtooth', this._uiGain, 0.18); }
    uiMenuOpen()   { this._envSweep(220, 660, 0.15, 'sine', this._uiGain, 0.16); }
    uiHeartbeat()  {
        this._envBeep(60, 0.18, 'sine', this._sfxGain, 0.30);
        setTimeout(() => this._envBeep(50, 0.12, 'sine', this._sfxGain, 0.22), 130);
    }

    // === Gameplay critical SFX ===
    firePie()        { this._envSweep(700, 380, 0.08, 'triangle', this._sfxGain, 0.16); }
    hitEnemy()       {
        this._noiseBurst(0.08, 2200, this._sfxGain, 0.16);
        this._envBeep(220, 0.06, 'square', this._sfxGain, 0.10);
    }
    hitWall()        { this._envBeep(180, 0.06, 'square', this._sfxGain, 0.08); }
    takeDamage()     {
        this._envSweep(440, 110, 0.22, 'sawtooth', this._sfxGain, 0.28);
        this._noiseBurst(0.10, 1400, this._sfxGain, 0.14);
    }
    playerDash()     { this._envSweep(180, 560, 0.18, 'sine', this._sfxGain, 0.14); }
    playerDeath()    {
        this._envSweep(440, 80, 0.6, 'sawtooth', this._sfxGain, 0.30);
        setTimeout(() => this._envSweep(330, 60, 0.5, 'sawtooth', this._sfxGain, 0.22), 200);
    }
    enemyDeath()     { this._envSweep(330, 110, 0.18, 'square', this._sfxGain, 0.16); }
    bossHit()        {
        this._noiseBurst(0.12, 1600, this._sfxGain, 0.22);
        this._envBeep(110, 0.16, 'sawtooth', this._sfxGain, 0.24);
    }
    slimeSquelch()   {
        this._envSweep(180, 80, 0.18, 'sawtooth', this._sfxGain, 0.18);
        this._noiseBurst(0.06, 800, this._sfxGain, 0.14);
    }

    // === Pickups ===
    collectCheese()  { this._envSweep(660, 1320, 0.10, 'triangle', this._sfxGain, 0.18); }
    collectHeart()   {
        this._envBeep(660, 0.08, 'sine', this._sfxGain, 0.18);
        setTimeout(() => this._envBeep(990, 0.10, 'sine', this._sfxGain, 0.18), 80);
    }
    collectPowerup() {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.10, 'triangle', this._sfxGain, 0.18), i * 60));
    }
    keyGrab()        {
        const notes = [880, 1175, 1568];
        notes.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.12, 'sine', this._sfxGain, 0.20), i * 100));
    }
    openChest()      {
        this._envBeep(440, 0.10, 'square', this._sfxGain, 0.16);
        setTimeout(() => this._envSweep(660, 1100, 0.18, 'triangle', this._sfxGain, 0.18), 100);
    }
    lightTorch()     {
        this._noiseBurst(0.18, 1800, this._sfxGain, 0.14);
        this._envBeep(440, 0.10, 'triangle', this._sfxGain, 0.10);
    }

    // === Stealth ===
    alarmTrigger()   {
        const beeps = [880, 660, 880, 660];
        beeps.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.14, 'square', this._sfxGain, 0.28), i * 140));
    }
    suspicionTick()  { this._envBeep(1320, 0.05, 'sine', this._sfxGain, 0.10); }
    distractionThud() {
        this._envBeep(120, 0.10, 'sine', this._sfxGain, 0.20);
        this._noiseBurst(0.06, 600, this._sfxGain, 0.10);
    }
    ghostRun()       {
        const notes = [523, 659, 784, 988, 1175];
        notes.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.18, 'sine', this._sfxGain, 0.16), i * 90));
    }

    // === Story / boss ===
    bossIntro()      {
        this._envSweep(110, 55, 1.2, 'sawtooth', this._sfxGain, 0.28);
        setTimeout(() => this._noiseBurst(0.4, 800, this._sfxGain, 0.16), 600);
    }
    bossPhase()      {
        this._envSweep(220, 660, 0.4, 'sawtooth', this._sfxGain, 0.24);
    }
    winStory()       {
        const fanfare = [523, 659, 784, 1047, 1318];
        fanfare.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.18, 'triangle', this._sfxGain, 0.22), i * 110));
    }
    loseStory()      {
        const dirge = [440, 392, 349, 294];
        dirge.forEach((f, i) => setTimeout(() => this._envBeep(f, 0.35, 'sawtooth', this._sfxGain, 0.20), i * 240));
    }
    floorEnter()     {
        this._envSweep(220, 880, 0.6, 'sine', this._sfxGain, 0.16);
    }
}
