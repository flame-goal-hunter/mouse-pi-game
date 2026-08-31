// ============================================
// Transylvania Menu — standalone HTML controller
// Replaces TransylvaniaScene. No Phaser. Drives ProgressStore + DOM.
// ============================================

import { Progress, SKINS, PERMANENT_UPGRADES } from './js/storage/ProgressStore.js';
import { playMenuSound } from './js/audio/menuAudio.js';

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

// ----- Shop icon kit — no emoji anywhere in the shop -----
const CHEESE_ICON = 'assets/characters/transylvania/cheese.svg';
// PERMANENT_UPGRADES ids (ProgressStore.js) mapped to icons from the kit.
const UPGRADE_ICONS = {
    hp1:     'assets/ui/heart.svg',
    speed1:  'assets/ui/bolt.svg',
    dash1:   'assets/ui/dash.svg',
    dmg1:    'assets/ui/flame.svg',
    powerup: 'assets/relics/gift.svg'
};
const UPGRADE_ICON_DEFAULT = 'assets/ui/target.svg';

function iconImg(src, cls) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = src;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    return img;
}

function checkMark(cls) {
    const el = document.createElement('span');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    return el;
}

function pricePill(amount, cls) {
    const pill = document.createElement('span');
    pill.className = cls;
    pill.appendChild(iconImg(CHEESE_ICON, 'price-cheese'));
    const n = document.createElement('span');
    n.className = 'price-value';
    n.textContent = String(amount);
    pill.appendChild(n);
    return pill;
}

// ----- Bestiary (matches Phaser scene's enemyList) -----
// sprite = the art DungeonScene.spawnEnemy() actually draws for this kind (biome
// variants reuse a base sprite with a tint — see DungeonScene.js:3414-3429):
// guard/librarian/boss -> zombie, chef -> cat, snapdragon -> slime.
const CHAR_BASE = 'assets/characters/transylvania/';
const ENEMY_LIST = [
    { kind: 'zombie',     name: 'Зомби',          sprite: CHAR_BASE + 'zombie.svg' },
    { kind: 'cat',        name: 'Кот',            sprite: CHAR_BASE + 'cat.svg' },
    { kind: 'slime',      name: 'Слизень',        sprite: CHAR_BASE + 'slime.svg' },
    { kind: 'bat',        name: 'Летучая мышь',   sprite: CHAR_BASE + 'bat.svg' },
    { kind: 'skeleton',   name: 'Скелет',         sprite: CHAR_BASE + 'skeleton.svg' },
    { kind: 'ghost',      name: 'Призрак',        sprite: CHAR_BASE + 'ghost.svg' },
    { kind: 'mimic',      name: 'Мимик',          sprite: CHAR_BASE + 'mimic.svg' },
    { kind: 'guard',      name: 'Страж',          sprite: CHAR_BASE + 'zombie.svg' },
    { kind: 'librarian',  name: 'Библиотекарь',   sprite: CHAR_BASE + 'zombie.svg' },
    { kind: 'chef',       name: 'Шеф-повар',      sprite: CHAR_BASE + 'cat.svg' },
    { kind: 'snapdragon', name: 'Львиный зев',    sprite: CHAR_BASE + 'slime.svg' },
    { kind: 'boss',       name: 'Босс',           sprite: CHAR_BASE + 'zombie.svg' }
];

// ----- Achievements list (matches scene) -----
const ACHIEVEMENTS = [
    { id: 'first_win',     name: 'Первая победа' },
    { id: 'five_wins',     name: 'Пять побед' },
    { id: 'speed_win',     name: 'Быстрая победа' },
    { id: 'boss_defeated', name: 'Босс повержен' },
    { id: 'boss_no_hit',   name: 'Босс без урона' },
    { id: 'combo_25',      name: 'Комбо x25' },
    { id: 'endless_10',    name: 'Этаж 10' },
    { id: 'endless_20',    name: 'Этаж 20' },
    { id: 'endless_30',    name: 'Этаж 30' }
];

// ----- DOM refs -----
const $ = (sel) => document.querySelector(sel);
const balanceEl = $('#balance-value');
const heroSpriteEl = $('#hero-sprite');
const heroPlateEl = $('#hero-plate');
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
const balancePillEl = $('#balance-pill');
const shopBalancePillEl = $('#shop-modal .modal-balance');

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
    if (heroPlateEl) heroPlateEl.classList.toggle('skin-equipped', !!skin.id && skin.id !== 'blue');
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
    playMenuSound('deny');
    toastEl.textContent = 'Не хватает сыра!';
    toastEl.classList.remove('show');
    // Force reflow so animation re-triggers
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 1150);

    [shopBalancePillEl, balancePillEl].forEach(pill => {
        if (!pill) return;
        pill.classList.remove('shake');
        void pill.offsetWidth;
        pill.classList.add('shake');
        setTimeout(() => pill.classList.remove('shake'), 480);
    });
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
    playMenuSound('open');
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
    const cheese = Progress.getCheese();
    skins.forEach(skin => {
        const unlocked = Progress.isSkinUnlocked(skin.id);
        const equipped = unlocked && current.id === skin.id;
        const affordable = unlocked || cheese >= skin.price;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'skin-card ' + (equipped ? 'equipped' : (unlocked ? 'unlocked' : 'locked'))
            + (affordable ? '' : ' unaffordable');
        card.setAttribute('data-skin-id', skin.id);
        if (!affordable) card.setAttribute('aria-disabled', 'true');
        card.setAttribute('aria-label', equipped
            ? `${skin.name} — надет`
            : (unlocked ? `${skin.name} — надеть` : `${skin.name} — ${skin.price} сыра`));

        const name = document.createElement('span');
        name.className = 'skin-name';
        name.textContent = skin.name;
        card.appendChild(name);

        const img = document.createElement('img');
        img.className = 'skin-preview';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.src = skinSrc(skin.id);
        img.onerror = () => { img.onerror = null; img.src = PI_BASE; };
        card.appendChild(img);

        if (equipped) {
            const badge = document.createElement('span');
            badge.className = 'skin-badge badge-owned';
            badge.appendChild(checkMark('badge-check'));
            badge.appendChild(document.createTextNode('НАДЕТ'));
            card.appendChild(badge);
        } else if (unlocked) {
            const badge = document.createElement('span');
            badge.className = 'skin-badge badge-wear';
            badge.textContent = 'НАДЕТЬ';
            card.appendChild(badge);
        } else {
            card.appendChild(pricePill(skin.price, 'skin-badge badge-price'));
        }

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
        playMenuSound('buy');
    }
    Progress.setSkin(skin.id);
    renderShop();
    renderHeader();
    renderHero();
}

function renderUpgradeList() {
    upgradeListEl.innerHTML = '';
    const cheese = Progress.getCheese();
    PERMANENT_UPGRADES.forEach(upg => {
        const lvl = Progress.getUpgradeLevel(upg.id);
        const maxed = lvl >= upg.maxLevel;
        const affordable = cheese >= upg.price;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'upgrade-card' + (maxed ? ' maxed' : (affordable ? '' : ' unaffordable'));
        card.setAttribute('data-upgrade-id', upg.id);
        if (maxed || !affordable) card.setAttribute('aria-disabled', 'true');

        card.appendChild(iconImg(UPGRADE_ICONS[upg.id] || UPGRADE_ICON_DEFAULT, 'upgrade-icon'));

        const info = document.createElement('span');
        info.className = 'upgrade-info';

        const title = document.createElement('span');
        title.className = 'upgrade-title';
        title.appendChild(document.createTextNode(upg.name));
        const lvlTag = document.createElement('span');
        lvlTag.className = 'upgrade-level';
        lvlTag.textContent = `(${lvl}/${upg.maxLevel})`;
        title.appendChild(lvlTag);
        info.appendChild(title);

        const desc = document.createElement('span');
        desc.className = 'upgrade-desc';
        desc.textContent = upg.desc;
        info.appendChild(desc);

        card.appendChild(info);

        if (maxed) {
            const done = document.createElement('span');
            done.className = 'upgrade-price is-maxed';
            done.appendChild(checkMark('badge-check'));
            done.appendChild(document.createTextNode('МАКС'));
            card.appendChild(done);
        } else {
            card.appendChild(pricePill(upg.price, 'upgrade-price'));
            card.addEventListener('click', () => onUpgradeClick(upg));
        }

        upgradeListEl.appendChild(card);
    });
}

function onUpgradeClick(upg) {
    const ok = Progress.buyUpgrade(upg.id);
    if (!ok) { flashNoCheese(); return; }
    playMenuSound('buy');
    renderShop();
    renderHeader();
}

// ----- Codex -----
function openCodex() {
    playMenuSound('open');
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
        row.setAttribute('aria-label', `${e.name} — ${discovered ? `убито ${kills}` : 'не встречен'}`);

        const img = iconImg(e.sprite, 'row-sprite');
        img.onerror = () => { img.onerror = null; img.src = PI_BASE; };
        row.appendChild(img);

        const nm = document.createElement('span');
        nm.className = 'row-name';
        nm.textContent = e.name;
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
    const skinsUnlocked = ((Progress.state && Progress.state.skinsUnlocked) || ['blue']).length;
    const skinsTotal = Progress.getAllSkins().length;

    const rows = [
        { icon: 'assets/ui-menu/trophy.svg', label: 'Сюжетных побед',   value: sStat.wins || 0 },
        { icon: 'assets/ui/stairs.svg',      label: 'Глубочайший этаж', value: eStat.bestFloor || 0 },
        { icon: 'assets/ui/paw.svg',         label: 'Тихих забегов',    value: ghostRuns },
        { icon: CHEESE_ICON,                 label: 'Сыра всего',       value: cheeseAllTime },
        { icon: PI_BASE,                     label: 'Скинов открыто',   value: `${skinsUnlocked}/${skinsTotal}` }
    ];
    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.appendChild(iconImg(r.icon, 'stat-icon'));
        const lbl = document.createElement('span');
        lbl.className = 'stat-label';
        lbl.textContent = r.label;
        const val = document.createElement('span');
        val.className = 'stat-value';
        val.textContent = String(r.value);
        row.appendChild(lbl);
        row.appendChild(val);
        statsBlockEl.appendChild(row);
    });
}

function renderAchievements() {
    achievementsListEl.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
        let unlocked = false;
        try { unlocked = !!(Progress.hasAchievement && Progress.hasAchievement(a.id)); } catch (e) {}
        const row = document.createElement('div');
        row.className = 'achievement-row ' + (unlocked ? 'unlocked' : 'locked');
        row.setAttribute('aria-label', `${a.name} — ${unlocked ? 'получено' : 'не получено'}`);

        if (unlocked) {
            row.appendChild(checkMark('badge-check achievement-icon'));
        } else {
            row.appendChild(iconImg('assets/world/lock.svg', 'achievement-icon achievement-lock'));
        }

        const nm = document.createElement('span');
        nm.className = 'achievement-name';
        nm.textContent = a.name;
        row.appendChild(nm);

        achievementsListEl.appendChild(row);
    });
}

// ----- Wire events -----
function handleBack() {
    playMenuSound('back');
    goBack();
}

function wireEvents() {
    $('#btn-back').addEventListener('click', handleBack);
    $('#card-story').addEventListener('click', () => { playMenuSound('click'); startRun('story'); });
    $('#card-endless').addEventListener('click', () => { playMenuSound('click'); startRun('endless'); });
    $('#btn-shop').addEventListener('click', () => openShop());     // openShop plays 'open'
    $('#btn-codex').addEventListener('click', () => openCodex());   // openCodex plays 'open'

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
        const wrappedBack = () => {
            playMenuSound('back');
            try { window.parent.postMessage('closePhaserSnowball', '*'); } catch (e) { goBack(); }
        };
        $('#btn-back').removeEventListener('click', handleBack);
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
