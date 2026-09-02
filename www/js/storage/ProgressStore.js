// ============================================
// PROGRESS STORE — persistent progression across runs (cheese bank, hats, upgrades, stats per mode)
// Saved via localStorage. Survives game restarts.
// Mode-aware: Story vs Endless tracked separately; shared economy.
// ============================================

const STORAGE_KEY = 'mousiePi.progress.v1';

// === SKINS — full Pi transformations.
// Each skin = its own SVG character.
export const SKINS = [
    // Every paid skin is a SIDEGRADE, not a costume: one thing it does better and one
    // it does worse, so a favourite is never a punishment and "dressing Pi up" and
    // "playing" stop being separate activities. apply() runs from a clean slate on
    // every floor, next to the upgrade and relic replay, so it must only adjust stats.
    { id: 'blue',          name: 'Обычный',        price: 0,   spriteKey: 'd_pi',               menuKey: 'm_pi',
      desc: 'Старый добрый Пи', defaultUnlocked: true,
      perk: { plus: 'Ничего лишнего', minus: 'И ничего особенного', apply: () => {} } },

    { id: 'brown',         name: 'Деревянный',     price: 80,  spriteKey: 'skin_brown',         menuKey: 'm_skin_brown',
      desc: 'Воин-пенёк из чащи',
      perk: { plus: 'Дольше не бьют после удара', minus: 'Бегает чуть медленнее',
              apply: (s) => { s.relicInvulnBonusMs = (s.relicInvulnBonusMs || 0) + 350;
                              s.speedMul = (s.speedMul || 1) * 0.94; } } },

    { id: 'pink',          name: 'Розовый',        price: 130, spriteKey: 'skin_pink',          menuKey: 'm_skin_pink',
      desc: 'Сладкий и стильный',
      perk: { plus: 'Сыр липнет издалека', minus: 'Пироги чуть меньше',
              apply: (s) => { s.relicMagnetRange = (s.relicMagnetRange || 0) + 120;
                              s.pieSizeMul = (s.pieSizeMul || 1) * 0.9; } } },

    { id: 'yellow_antler', name: 'Жёлтый с рогами',price: 200, spriteKey: 'skin_yellow_antler', menuKey: 'm_skin_yellow_antler',
      desc: 'Гордый рогатый странник',
      perk: { plus: 'Пирог бьёт сильнее', minus: 'Дольше набирает пироги',
              apply: (s) => { s.pieDmgBonus = (s.pieDmgBonus || 0) + 1;
                              s.reloadMul = (s.reloadMul || 1) * 1.25; } } },

    { id: 'robot',         name: 'Робот',          price: 250, spriteKey: 'skin_robot',         menuKey: 'm_skin_robot',
      desc: 'Сталь и шестерёнки',
      perk: { plus: 'Переживает лишний удар', minus: 'Громко топает',
              apply: (s) => { s.maxHp += 1; s.stealthMul = (s.stealthMul || 1) * 1.35; } } },

    { id: 'green_monster', name: 'Зелёный монстр', price: 500, spriteKey: 'skin_green_monster', menuKey: 'm_skin_green_monster',
      desc: 'Лесное чудище',
      perk: { plus: 'На два пирога больше в лапах', minus: 'Бегает медленнее',
              apply: (s) => { s.clipBonus = (s.clipBonus || 0) + 2;
                              s.speedMul = (s.speedMul || 1) * 0.9; } } },

    { id: 'shadow',        name: 'Тень',           price: 750, spriteKey: 'skin_shadow',        menuKey: 'm_skin_shadow',
      desc: 'Тихий охотник из мрака',
      perk: { plus: 'Крадётся тише всех', minus: 'Хуже видит в темноте',
              apply: (s) => { s.stealthMul = (s.stealthMul || 1) * 0.6;
                              s.lightMul = (s.lightMul || 1) * 0.78; } } },

    { id: 'devil',         name: 'Дьяволёнок',     price: 800, spriteKey: 'skin_devil',         menuKey: 'm_skin_devil',
      desc: 'Рога, хвост и проблемы',
      perk: { plus: 'Рывок готов быстрее', minus: 'Дольше набирает пироги',
              apply: (s) => { s.dashCdMul = (s.dashCdMul || 1) * 0.72;
                              s.reloadMul = (s.reloadMul || 1) * 1.2; } } },

    { id: 'angel',         name: 'Ангелочек',      price: 800, spriteKey: 'skin_angel',         menuKey: 'm_skin_angel',
      desc: 'Сияет, как нимб',
      perk: { plus: 'Видит дальше', minus: 'И его видно дальше',
              apply: (s) => { s.lightMul = (s.lightMul || 1) * 1.3;
                              s.stealthMul = (s.stealthMul || 1) * 1.3; } } },

    { id: 'yellow_lion',   name: 'Львёнок',        price: 950, spriteKey: 'skin_yellow_lion',   menuKey: 'm_skin_yellow_lion',
      desc: 'Король сырных земель',
      perk: { plus: 'Бегает быстрее всех', minus: 'Пирог бьёт слабее',
              apply: (s) => { s.speedMul = (s.speedMul || 1) * 1.12;
                              s.pieDmgBonus = (s.pieDmgBonus || 0) - 1; } } },

    // First new family (see docs/.../2026-09-02-skin-style-brief.md): the nine had no
    // big-and-kind, no watery one and no bookish one. Drawn on the same skeleton and
    // given sidegrades that do not repeat any existing pair.
    { id: 'bear',          name: 'Медвежонок',     price: 300, spriteKey: 'skin_bear',          menuKey: 'm_skin_bear',
      desc: 'Большой, тёплый, с мёдом',
      perk: { plus: 'Иногда сердечко за врага', minus: 'Бегает медленнее',
              apply: (s) => { s.lifestealChance = (s.lifestealChance || 0) + 0.2;
                              s.speedMul = (s.speedMul || 1) * 0.92; } } },

    { id: 'frog',          name: 'Лягушонок',      price: 400, spriteKey: 'skin_frog',          menuKey: 'm_skin_frog',
      desc: 'Прыгает дальше всех',
      perk: { plus: 'Рывок готов гораздо быстрее', minus: 'Меньше пирогов в лапах',
              apply: (s) => { s.dashCdMul = (s.dashCdMul || 1) * 0.6;
                              s.clipBonus = (s.clipBonus || 0) - 2; } } },

    { id: 'professor',     name: 'Профессор',      price: 600, spriteKey: 'skin_professor',     menuKey: 'm_skin_professor',
      desc: 'Читал про этот замок всё',
      perk: { plus: 'Больше сыра за кусочек', minus: 'Пирог бьёт слабее',
              apply: (s) => { s.cheeseMul = (s.cheeseMul || 1) * 1.4;
                              s.pieDmgBonus = (s.pieDmgBonus || 0) - 1; } } }
];

// === PERMANENT UPGRADES — bought once, stack each run forever ===
// dmg1 maxLevel dropped to 1 to keep boss tension (Q1 recommended)
export const PERMANENT_UPGRADES = [
    { id: 'hp1',     icon: 'ui_heart', name: 'Лишнее сердце', price: 80,  desc: 'Начинаешь с ещё одним сердцем', maxLevel: 3 },
    { id: 'speed1',  icon: 'ui_bolt', name: 'Лёгкие лапы',   price: 120, desc: 'Пи бегает чуть быстрее', maxLevel: 3 },
    { id: 'dash1',   icon: 'ui_dash', name: 'Быстрый рывок', price: 180, desc: 'Рывок готов быстрее', maxLevel: 2 },
    { id: 'dmg1',    icon: 'ui_flame', name: 'Острый пирог',  price: 250, desc: 'Пироги бьют сильнее', maxLevel: 1 },
    { id: 'powerup', icon: 'relic_gift', name: 'Стартовый бонус', price: 350, desc: 'Начинаешь этаж с подарком', maxLevel: 1 }
];

const DEFAULT_STATE = {
    // === Shared economy ===
    cheeseBank: 0,
    cheeseEarnedAllTime: 0,
    // === Skins ===
    skinsUnlocked: ['blue'],
    currentSkin: 'blue',
    upgrades: {},               // id -> level

    // === Per-mode stats ===
    stats: {
        story: {
            runs: 0,
            wins: 0,
            losses: 0,
            bestScore: 0,
            fastestClearMs: 0,    // 0 = never won
            firstWinDate: null
        },
        endless: {
            runs: 0,
            bestFloor: 0,
            bestScore: 0,
            lastRunDate: null
        },
        sneak: {
            runs: 0,
            clears: 0,
            captures: 0,
            ghostNights: 0,
            lastRunDate: null
        }
    },
    lastRunMode: 'story',

    // === Long-tail ===
    enemyKills: {},             // kind -> count (for codex)
    achievementsUnlocked: [],   // array of achievement ids
    ghostRuns: 0,               // floors cleared with 0 alarms

    // === Settings ===
    audioPrefs: {
        master: 1.0,
        sfx: 0.85,
        music: 0.60,
        ui: 0.80,
        muted: false,
        haptics: true
    },

    // === Versioning for migrations ===
    saveVersion: 2,

    // === Legacy (kept for back-compat reads) ===
    runsWon: 0,
    runsLost: 0,
    bestScore: 0
};

let _state = null;

function deepMerge(target, source) {
    // Recursively merge defaults into source so missing keys get filled
    if (target === null || typeof target !== 'object') return source !== undefined ? source : target;
    if (Array.isArray(target)) return Array.isArray(source) ? source : target.slice();
    const safeSource = (source && typeof source === 'object' && !Array.isArray(source)) ? source : {};
    const out = { ...safeSource };
    for (const k in target) {
        const tv = target[k];
        if (tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
            out[k] = deepMerge(tv, safeSource[k]);
        } else if (out[k] === undefined) {
            out[k] = tv;
        }
    }
    return out;
}

function load() {
    if (_state) return _state;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) { _state = JSON.parse(JSON.stringify(DEFAULT_STATE)); return _state; }
        const parsed = JSON.parse(raw);
        _state = deepMerge(DEFAULT_STATE, parsed);
        if (!_state.skinsUnlocked.includes('blue')) _state.skinsUnlocked.push('blue');
    } catch (e) {
        console.warn('[ProgressStore] failed to load', e);
        _state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
    return _state;
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
    } catch (e) {
        console.warn('[ProgressStore] failed to save', e);
    }
}

export const Progress = {
    get state() { return load(); },

    // === Cheese bank ===
    addCheese(amount) {
        amount = Math.max(0, Math.round(amount || 0));   // the bank only ever holds whole cheese
        const s = load();
        s.cheeseBank += amount;
        s.cheeseEarnedAllTime += amount;
        save();
    },
    spendCheese(amount) {
        const s = load();
        if (s.cheeseBank < amount) return false;
        s.cheeseBank -= amount;
        save();
        return true;
    },
    getCheese() { return load().cheeseBank; },

    // === Skins (new primary API) ===
    unlockSkin(id) {
        const s = load();
        if (!s.skinsUnlocked.includes(id)) {
            s.skinsUnlocked.push(id);
            save();
        }
    },
    setSkin(id) {
        const s = load();
        if (s.skinsUnlocked.includes(id)) {
            s.currentSkin = id;
            save();
        }
    },
    getCurrentSkin() {
        const s = load();
        return SKINS.find(x => x.id === s.currentSkin) || SKINS[0];
    },
    isSkinUnlocked(id) {
        return load().skinsUnlocked.includes(id);
    },
    getAllSkins() { return SKINS.slice(); },

    // === Permanent upgrades ===
    getUpgradeLevel(id) { return load().upgrades[id] || 0; },
    buyUpgrade(id) {
        const def = PERMANENT_UPGRADES.find(u => u.id === id);
        if (!def) return false;
        const s = load();
        const cur = s.upgrades[id] || 0;
        if (cur >= def.maxLevel) return false;
        if (s.cheeseBank < def.price) return false;
        s.cheeseBank -= def.price;
        s.upgrades[id] = cur + 1;
        save();
        return true;
    },

    // === Mode-aware stats ===
    setLastRunMode(mode) {
        const s = load();
        s.lastRunMode = mode;
        save();
    },
    getLastRunMode() { return load().lastRunMode || 'story'; },

    recordStoryWin(score, durationMs) {
        const s = load();
        s.stats.story.runs++;
        s.stats.story.wins++;
        if (score > s.stats.story.bestScore) s.stats.story.bestScore = score;
        if (durationMs && (s.stats.story.fastestClearMs === 0 || durationMs < s.stats.story.fastestClearMs)) {
            s.stats.story.fastestClearMs = durationMs;
        }
        if (!s.stats.story.firstWinDate) s.stats.story.firstWinDate = Date.now();
        // Story-win reward: a free skin (pink only — angel stays paid)
        if (!s.skinsUnlocked.includes('pink')) s.skinsUnlocked.push('pink');
        // Achievements
        if (!s.achievementsUnlocked.includes('first_win')) s.achievementsUnlocked.push('first_win');
        if (s.stats.story.wins >= 5 && !s.achievementsUnlocked.includes('five_wins')) s.achievementsUnlocked.push('five_wins');
        if (durationMs > 0 && durationMs < 600000 && !s.achievementsUnlocked.includes('speed_win')) s.achievementsUnlocked.push('speed_win');
        save();
    },
    recordStoryLoss(score) {
        const s = load();
        s.stats.story.runs++;
        s.stats.story.losses++;
        if (score > s.stats.story.bestScore) s.stats.story.bestScore = score;
        save();
    },
    recordEndlessRun(floor, score) {
        const s = load();
        s.stats.endless.runs++;
        if (floor > s.stats.endless.bestFloor) s.stats.endless.bestFloor = floor;
        if (score > s.stats.endless.bestScore) s.stats.endless.bestScore = score;
        s.stats.endless.lastRunDate = Date.now();
        // Achievements + milestone hat
        if (floor >= 10 && !s.achievementsUnlocked.includes('endless_10')) s.achievementsUnlocked.push('endless_10');
        if (floor >= 20 && !s.achievementsUnlocked.includes('endless_20')) s.achievementsUnlocked.push('endless_20');
        if (floor >= 30 && !s.achievementsUnlocked.includes('endless_30')) s.achievementsUnlocked.push('endless_30');
        if (floor >= 20 && !s.skinsUnlocked.includes('devil')) s.skinsUnlocked.push('devil');
        save();
    },
    recordSneakRun({ cleared, neverSeen, cheese }) {
        const s = load();
        s.stats.sneak.runs++;
        if (cleared) s.stats.sneak.clears++;
        else s.stats.sneak.captures++;
        if (neverSeen) s.stats.sneak.ghostNights++;
        s.stats.sneak.lastRunDate = Date.now();
        if (cheese > 0) {
            s.cheeseBank += cheese;
            s.cheeseEarnedAllTime += cheese;
        }
        save();
    },
    getSneakStats() {
        const s = load();
        return (s.stats && s.stats.sneak) || { runs: 0, clears: 0, captures: 0, ghostNights: 0, lastRunDate: null };
    },
    getStoryStats() {
        const s = load();
        return (s.stats && s.stats.story) || { runs: 0, wins: 0, losses: 0, bestScore: 0, fastestClearMs: 0, firstWinDate: null };
    },
    getEndlessStats() {
        const s = load();
        return (s.stats && s.stats.endless) || { runs: 0, bestFloor: 0, bestScore: 0, lastRunDate: null };
    },

    // === Legacy stats — kept for back-compat ===
    recordWin(score) { this.recordStoryWin(score, 0); },
    recordLoss(score) { this.recordStoryLoss(score); },

    // === Codex ===
    recordKill(kind) {
        const s = load();
        s.enemyKills[kind] = (s.enemyKills[kind] || 0) + 1;
        save();
    },
    getKills(kind) { return load().enemyKills[kind] || 0; },
    getAllKills() { return load().enemyKills; },

    // === Achievements ===
    unlockAchievement(id) {
        const s = load();
        if (s.achievementsUnlocked.includes(id)) return false;
        s.achievementsUnlocked.push(id);
        save();
        return true;
    },
    hasAchievement(id) { return load().achievementsUnlocked.includes(id); },

    // === Ghost runs (stealth) ===
    incrementGhostRuns() {
        const s = load();
        s.ghostRuns++;
        if (s.ghostRuns >= 10 && !s.skinsUnlocked.includes('shadow')) s.skinsUnlocked.push('shadow');
        save();
    },
    getGhostRuns() { return load().ghostRuns; },

    // === Audio prefs ===
    getAudioPrefs() { return load().audioPrefs; },
    setAudioPref(key, value) {
        const s = load();
        s.audioPrefs[key] = value;
        save();
    },
    toggleMute() {
        const s = load();
        s.audioPrefs.muted = !s.audioPrefs.muted;
        save();
        return s.audioPrefs.muted;
    },

    // === Apply permanent upgrades to player stats at run start ===
    applyTo(scene) {
        const lvl = id => this.getUpgradeLevel(id);
        if (lvl('hp1') > 0) scene.maxHp += lvl('hp1');
        if (lvl('speed1') > 0) scene.speedMul *= (1 + 0.10 * lvl('speed1'));
        if (lvl('dash1') > 0) scene.dashCdMul *= Math.pow(0.85, lvl('dash1'));
        if (lvl('dmg1') > 0) scene.pieDmgBonus += lvl('dmg1');
    },

    // === Devtool / reset ===
    resetAll() {
        _state = JSON.parse(JSON.stringify(DEFAULT_STATE));
        save();
    }
};
