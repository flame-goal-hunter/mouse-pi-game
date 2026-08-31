// ============================================
// Transylvania Menu — standalone HTML controller
// Replaces TransylvaniaScene. No Phaser. Drives ProgressStore + DOM.
// ============================================

import { Progress, SKINS, PERMANENT_UPGRADES } from './js/storage/ProgressStore.js';

// ----- Asset path helpers -----
// Skin IDs use underscores ('yellow_antler'), filenames use hyphens ('yellow-antler.svg').
// Base 'blue' skin uses pi.svg.
const SKIN_BASE = 'assets/characters/transylvania/skins/';
const PI_BASE = 'assets/characters/transylvania/pi.svg';

function skinSrc(skinId) {
    if (!skinId || skinId === 'blue') return PI_BASE;
    const fileBase = skinId.replace(/_/g, '-');
    return `${SKIN_BASE}${fileBase}.svg`;
}

// ----- Bestiary (matches Phaser scene's enemyList) -----
const ENEMY_LIST = [
    { kind: 'zombie',     name: 'Зомби',          emoji: '🧟' },
    { kind: 'cat',        name: 'Кот',            emoji: '🐈' },
    { kind: 'slime',      name: 'Слизень',        emoji: '🫐' },
    { kind: 'bat',        name: 'Летучая мышь',   emoji: '🦇' },
    { kind: 'skeleton',   name: 'Скелет',         emoji: '💀' },
    { kind: 'ghost',      name: 'Призрак',        emoji: '👻' },
    { kind: 'mimic',      name: 'Мимик',          emoji: '🎁' },
    { kind: 'guard',      name: 'Страж',          emoji: '🛡️' },
    { kind: 'librarian',  name: 'Библиотекарь',   emoji: '📚' },
    { kind: 'chef',       name: 'Шеф-повар',      emoji: '🍳' },
    { kind: 'snapdragon', name: 'Львиный зев',    emoji: '🌸' },
    { kind: 'boss',       name: 'Босс',           emoji: '👹' }
];

// ----- Achievements list (matches scene) -----
const ACHIEVEMENTS = [
    { id: 'first_win',     emoji: '🌟', name: 'Первая победа' },
    { id: 'five_wins',     emoji: '🏆', name: 'Пять побед' },
    { id: 'speed_win',     emoji: '⚡',       name: 'Быстрая победа' },
    { id: 'boss_defeated', emoji: '👑', name: 'Босс повержен' },
    { id: 'boss_no_hit',   emoji: '🛡️', name: 'Босс без урона' },
    { id: 'combo_25',      emoji: '🔥', name: 'Комбо x25' },
    { id: 'endless_10',    emoji: '🔽', name: 'Этаж 10' },
    { id: 'endless_20',    emoji: '💥', name: 'Этаж 20' },
    { id: 'endless_30',    emoji: '💀', name: 'Этаж 30' }
];

// ----- DOM refs -----
const $ = (sel) => document.querySelector(sel);
const balanceEl = $('#balance-value');
const heroSpriteEl = $('#hero-sprite');
const heroNameEl = $('#hero-name');
const storyHintEl = $('#story-hint');
const endlessHintEl = $('#endless-hint');
const shopModal = $('#shop-modal');
const codexModal = $('#codex-modal');
const shopBalanceEl = $('#shop-balance-value');
const skinGridEl = $('#skin-grid');
const upgradeListEl = $('#upgrade-list');
const bestiaryListEl = $('#bestiary-list');
const statsBlockEl = $('#stats-block');
const achievementsListEl = $('#achievements-list');
const toastEl = $('#toast');

// ----- Render: header / hero / mode hints -----
function renderHeader() {
    const balance = Progress.getCheese();
    balanceEl.textContent = String(balance);
}

function renderHero() {
    const skin = Progress.getCurrentSkin();
    heroSpriteEl.setAttribute('src', skinSrc(skin.id));
    heroSpriteEl.setAttribute('alt', skin.name || 'Мышонок Пи');
    heroNameEl.textContent = skin.name || 'Мышонок Пи';
    // Fallback if SVG fails (e.g., file missing) — swap to pi.svg
    heroSpriteEl.onerror = () => {
        heroSpriteEl.onerror = null;
        heroSpriteEl.setAttribute('src', PI_BASE);
    };
}

function renderModeHints() {
    let sStat = { wins: 0 };
    let eStat = { bestFloor: 0 };
    try { sStat = Progress.getStoryStats() || sStat; } catch (e) {}
    try { eStat = Progress.getEndlessStats() || eStat; } catch (e) {}
    storyHintEl.textContent = sStat.wins > 0
        ? `Спасений: ${sStat.wins}`
        : '5 этажей · босс · спасение';
    endlessHintEl.textContent = eStat.bestFloor > 0
        ? `Лучший этаж: ${eStat.bestFloor}`
        : 'Спускайся вечно · растущая сложность';
}

function renderAll() {
    renderHeader();
    renderHero();
    renderModeHints();
}

// ----- Toast (insufficient cheese) -----
function flashNoCheese() {
    toastEl.textContent = 'Не хватает сыра!';
    toastEl.classList.remove('show');
    // Force reflow so animation re-triggers
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1150);
}

// ----- Navigation -----
function startRun(runMode) {
    try { Progress.setLastRunMode(runMode); } catch (e) {}
    window.location.href = `game-phaser.html?mode=transylvania&runMode=${encodeURIComponent(runMode)}`;
}

function goBack() {
    // Prefer history if we got here from index.html; otherwise go to root.
    if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.host) !== -1) {
        window.history.back();
    } else {
        window.location.href = 'index.html';
    }
}

// ----- Shop -----
function openShop() {
    renderShop();
    shopModal.style.display = 'flex';
    shopModal.setAttribute('aria-hidden', 'false');
}

function closeShop() {
    shopModal.style.display = 'none';
    shopModal.setAttribute('aria-hidden', 'true');
}

function renderShop() {
    shopBalanceEl.textContent = String(Progress.getCheese());
    renderSkinGrid();
    renderUpgradeList();
}

function renderSkinGrid() {
    skinGridEl.innerHTML = '';
    const skins = Progress.getAllSkins();
    const current = Progress.getCurrentSkin();
    skins.forEach(skin => {
        const unlocked = Progress.isSkinUnlocked(skin.id);
        const equipped = unlocked && current.id === skin.id;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'skin-card' + (equipped ? ' equipped' : (unlocked ? ' unlocked' : ' locked'));
        card.setAttribute('data-skin-id', skin.id);

        const name = document.createElement('div');
        name.className = 'skin-name';
        name.textContent = skin.name;
        card.appendChild(name);

        const img = document.createElement('img');
        img.className = 'skin-preview';
        img.alt = skin.name;
        img.src = skinSrc(skin.id);
        img.onerror = () => { img.onerror = null; img.src = PI_BASE; };
        card.appendChild(img);

        const badge = document.createElement('div');
        badge.className = 'skin-badge';
        if (equipped) badge.textContent = '✓ НАДЕТ';
        else if (unlocked) badge.textContent = 'НАДЕТЬ';
        else badge.textContent = `🧀 ${skin.price}`;
        card.appendChild(badge);

        card.addEventListener('click', () => onSkinClick(skin));
        skinGridEl.appendChild(card);
    });
}

function onSkinClick(skin) {
    const unlocked = Progress.isSkinUnlocked(skin.id);
    if (!unlocked) {
        const ok = Progress.spendCheese(skin.price);
        if (!ok) { flashNoCheese(); return; }
        Progress.unlockSkin(skin.id);
    }
    Progress.setSkin(skin.id);
    renderShop();
    renderHeader();
    renderHero();
}

function renderUpgradeList() {
    upgradeListEl.innerHTML = '';
    PERMANENT_UPGRADES.forEach(upg => {
        const lvl = Progress.getUpgradeLevel(upg.id);
        const maxed = lvl >= upg.maxLevel;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'upgrade-card' + (maxed ? ' maxed' : '');
        card.setAttribute('data-upgrade-id', upg.id);

        const icon = document.createElement('span');
        icon.className = 'upgrade-icon';
        icon.textContent = upg.emoji;
        card.appendChild(icon);

        const info = document.createElement('span');
        info.className = 'upgrade-info';

        const title = document.createElement('span');
        title.className = 'upgrade-title';
        title.textContent = `${upg.name}  (${lvl}/${upg.maxLevel})`;
        info.appendChild(title);

        const desc = document.createElement('span');
        desc.className = 'upgrade-desc';
        desc.textContent = upg.desc;
        info.appendChild(desc);

        card.appendChild(info);

        const price = document.createElement('span');
        price.className = 'upgrade-price';
        price.textContent = maxed ? 'МАКС' : `🧀 ${upg.price}`;
        card.appendChild(price);

        if (!maxed) {
            card.addEventListener('click', () => onUpgradeClick(upg));
        }
        upgradeListEl.appendChild(card);
    });
}

function onUpgradeClick(upg) {
    const ok = Progress.buyUpgrade(upg.id);
    if (!ok) { flashNoCheese(); return; }
    renderShop();
    renderHeader();
}

// ----- Codex -----
function openCodex() {
    renderCodex();
    codexModal.style.display = 'flex';
    codexModal.setAttribute('aria-hidden', 'false');
}

function closeCodex() {
    codexModal.style.display = 'none';
    codexModal.setAttribute('aria-hidden', 'true');
}

function renderCodex() {
    renderBestiary();
    renderStats();
    renderAchievements();
}

function renderBestiary() {
    bestiaryListEl.innerHTML = '';
    let allKills = {};
    try { allKills = Progress.getAllKills() || {}; } catch (e) {}
    ENEMY_LIST.forEach(e => {
        const kills = allKills[e.kind] || 0;
        const discovered = kills > 0;
        const row = document.createElement('div');
        row.className = 'bestiary-row ' + (discovered ? 'discovered' : 'unknown');
        const em = document.createElement('span');
        em.className = 'row-emoji';
        em.textContent = discovered ? e.emoji : '❓';
        row.appendChild(em);
        const nm = document.createElement('span');
        nm.className = 'row-name';
        nm.textContent = discovered ? e.name : '???';
        row.appendChild(nm);
        const cnt = document.createElement('span');
        cnt.className = 'row-count';
        cnt.textContent = discovered ? `×${kills}` : 'не встречен';
        row.appendChild(cnt);
        bestiaryListEl.appendChild(row);
    });
}

function renderStats() {
    statsBlockEl.innerHTML = '';
    let sStat = { wins: 0 };
    let eStat = { bestFloor: 0 };
    let ghostRuns = 0;
    try { sStat = Progress.getStoryStats() || sStat; } catch (e) {}
    try { eStat = Progress.getEndlessStats() || eStat; } catch (e) {}
    try { ghostRuns = Progress.getGhostRuns() || 0; } catch (e) {}
    const cheeseAllTime = (Progress.state && Progress.state.cheeseEarnedAllTime) || 0;

    const rows = [
        { emoji: '📖', label: 'Сюжетных побед',  value: sStat.wins || 0 },
        { emoji: '📏', label: 'Глубочайший этаж', value: eStat.bestFloor || 0 },
        { emoji: '🥷', label: 'Тихих забегов',   value: ghostRuns },
        { emoji: '🧀', label: 'Сыра всего',       value: cheeseAllTime }
    ];
    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        const em = document.createElement('span');
        em.textContent = r.emoji;
        const lbl = document.createElement('span');
        lbl.className = 'stat-label';
        lbl.textContent = r.label;
        const val = document.createElement('span');
        val.className = 'stat-value';
        val.textContent = String(r.value);
        row.appendChild(em);
        row.appendChild(lbl);
        row.appendChild(val);
        statsBlockEl.appendChild(row);
    });

    // Skin progress
    const skinsUnlocked = ((Progress.state && Progress.state.skinsUnlocked) || ['blue']).length;
    const skinsTotal = Progress.getAllSkins().length;
    const sp = document.createElement('div');
    sp.className = 'skin-progress';
    sp.textContent = `🐭  Скинов открыто: ${skinsUnlocked}/${skinsTotal}`;
    statsBlockEl.appendChild(sp);
}

function renderAchievements() {
    achievementsListEl.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
        let unlocked = false;
        try { unlocked = !!(Progress.hasAchievement && Progress.hasAchievement(a.id)); } catch (e) {}
        const row = document.createElement('div');
        row.className = 'achievement-row ' + (unlocked ? 'unlocked' : 'locked');
        const em = document.createElement('span');
        em.className = 'row-emoji';
        em.textContent = unlocked ? a.emoji : '🔒';
        row.appendChild(em);
        const nm = document.createElement('span');
        nm.textContent = unlocked ? a.name : '???';
        row.appendChild(nm);
        achievementsListEl.appendChild(row);
    });
}

// ----- Wire events -----
function wireEvents() {
    $('#btn-back').addEventListener('click', goBack);
    $('#card-story').addEventListener('click', () => startRun('story'));
    $('#card-endless').addEventListener('click', () => startRun('endless'));
    $('#btn-shop').addEventListener('click', openShop);
    $('#btn-codex').addEventListener('click', openCodex);

    // Close handlers (backdrop + close buttons share data-close attr)
    document.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', (ev) => {
            const which = el.getAttribute('data-close');
            if (which === 'shop') closeShop();
            else if (which === 'codex') closeCodex();
            ev.stopPropagation();
        });
    });

    // Hardware back button on Android (Capacitor) — if modal open, close it; else go back.
    window.addEventListener('popstate', () => {
        if (shopModal.style.display !== 'none') { closeShop(); return; }
        if (codexModal.style.display !== 'none') { closeCodex(); return; }
    });

    // ESC closes modals on desktop
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            if (shopModal.style.display !== 'none') closeShop();
            else if (codexModal.style.display !== 'none') closeCodex();
        }
    });

    // Parent-frame back contract — if embedded in an iframe via index.html
    // (the Phaser scene used postMessage; we keep parity).
    if (window.parent && window.parent !== window) {
        const origBack = goBack;
        const wrappedBack = () => {
            try { window.parent.postMessage('closePhaserSnowball', '*'); } catch (e) { origBack(); }
        };
        $('#btn-back').removeEventListener('click', goBack);
        $('#btn-back').addEventListener('click', wrappedBack);
    }
}

// ----- Auto-open shop if requested -----
function maybeAutoOpen() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('openShop') === '1') {
        setTimeout(openShop, 250);
    }
}

// ----- Boot -----
function boot() {
    renderAll();
    wireEvents();
    maybeAutoOpen();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
