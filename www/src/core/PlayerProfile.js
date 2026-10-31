// ============================================================================
// PlayerProfile.js — Единый профиль Мышонка Пи (скины, сыр, ник, planetAppearance)
// Синхронизируется с mousiePi.progress.v1 для полной совместимости со всеми играми
// ============================================================================

import { getDefaultAppearance } from '../space_hub/PersonalPlanetSystem.js';

const PROGRESS_KEY = 'mousiePi.progress.v1';
const SPACE_KEY = 'mousiePi.spaceProfile.v1';

export const SKIN_CATALOG = [
    { id: 'blue',          name: 'Мышонок Пи',       price: 0,   body: '#7ec8e3', desc: 'Классический отважный астронавт Пи' },
    { id: 'brown',         name: 'Деревянный',       price: 80,  body: '#a5764a', desc: 'Воин-пенёк из лесной чащи' },
    { id: 'pink',          name: 'Розовая Принцесса',price: 130, body: '#ff9ec7', desc: 'Сладкий и стильный розовый образ' },
    { id: 'yellow_antler', name: 'Жёлтый с рогами',  price: 200, body: '#f5d76e', desc: 'Гордый рогатый странник' },
    { id: 'robot',         name: 'Робот Пи-3000',    price: 250, body: '#9aa5b1', desc: 'Сталь, антенна и шестерёнки' },
    { id: 'bear',          name: 'Медвежонок',       price: 300, body: '#a06a34', desc: 'Большой, тёплый, с бочонком мёда' },
    { id: 'pirate',        name: 'Космо-Пират',      price: 350, body: '#c96a4a', desc: 'Бандана, крюк и звёздный компас' },
    { id: 'beaver',        name: 'Бобёр-Строитель',  price: 360, body: '#9a4e1c', desc: 'Зубы-долото и хвост-лопатка!' },
    { id: 'cockroach',     name: 'Забавный таракан', price: 380, body: '#7c230c', desc: 'Шестилапый усач — тапки не догонят!' },
    { id: 'frog',          name: 'Лягушонок',        price: 400, body: '#4caf50', desc: 'Чемпион по космическим прыжкам' },
    { id: 'kitty',         name: 'Кошечка',          price: 450, body: '#f2a6c8', desc: 'Ушки торчком и пушистый хвост' },
    { id: 'green_monster', name: 'Зелёный монстр',   price: 500, body: '#4caf50', desc: 'Доброе лесное чудище' },
    { id: 'professor',     name: 'Профессор',        price: 600, body: '#8f7ab0', desc: 'Знает тайны всех созвездий' },
    { id: 'astronaut',     name: 'Звёздный Капитан', price: 700, body: '#dfe6f2', desc: 'В скафандре и с реактивным ранцем' },
    { id: 'shadow',        name: 'Ночная Тень',      price: 750, body: '#202028', desc: 'Невидимый охотник из туманности' },
    { id: 'devil',         name: 'Дьяволёнок',       price: 800, body: '#d04030', desc: 'Огненные рожки и азарт' },
    { id: 'angel',         name: 'Ангелочек',        price: 800, body: '#fff8d0', desc: 'Сияет ярче сверхновой звезды' },
    { id: 'yellow_lion',   name: 'Золотой Львёнок',  price: 950, body: '#f5c542', desc: 'Король сырной галактики' }
];

const _spriteCache = new Map();
function _readJson(k, fb) { try { const r = localStorage.getItem(k); return r ? { ...fb, ...JSON.parse(r) } : { ...fb }; } catch (_) { return { ...fb }; } }
function _writeJson(k, obj) { try { localStorage.setItem(k, JSON.stringify(obj)); } catch (_) {} }

class PlayerProfileStore {
    constructor() {
        this._listeners = new Set();
        this.currentLocation = 'space';
        this._syncFromStorage();
    }

    _syncFromStorage() {
        const prog = _readJson(PROGRESS_KEY, { cheeseBank: 50, skinsUnlocked: ['blue'], currentSkin: 'blue' });
        const defId = 'pi_' + Math.random().toString(36).slice(2, 8);
        const defNick = (typeof localStorage !== 'undefined' && localStorage.getItem('mousie_nickname')) || ('Пи-' + Math.floor(100 + Math.random() * 899));
        const space = _readJson(SPACE_KEY, {
            playerId: defId, nickname: defNick, pocketCheese: 12,
            storedCheese: typeof prog.cheeseBank === 'number' ? prog.cheeseBank : 50,
            equippedSkinId: prog.currentSkin || 'blue',
            unlockedSkins: Array.isArray(prog.skinsUnlocked) ? prog.skinsUnlocked : ['blue'],
            planetAppearance: null,
            musicTrackId: 'space_chill'
        });

        this.playerId = space.playerId || defId;
        this.nickname = (space.nickname || defNick).slice(0, 16);
        this.unlockedSkins = Array.from(new Set(['blue', ...(prog.skinsUnlocked || []), ...(space.unlockedSkins || [])]));
        const cand = prog.currentSkin || space.equippedSkinId;
        this.equippedSkinId = SKIN_CATALOG.some(s => s.id === cand) ? cand : 'blue';
        this.pocketCheese = Math.max(0, Math.round(space.pocketCheese || 0));
        this.storedCheese = Math.max(prog.cheeseBank || 0, space.storedCheese || 0);
        this.planetAppearance = space.planetAppearance || getDefaultAppearance(this.playerId, this.nickname);
        this.musicTrackId = space.musicTrackId || 'space_chill';
        this._persist();
    }

    _persist() {
        _writeJson(SPACE_KEY, {
            playerId: this.playerId, nickname: this.nickname,
            equippedSkinId: this.equippedSkinId, unlockedSkins: this.unlockedSkins,
            pocketCheese: this.pocketCheese, storedCheese: this.storedCheese,
            planetAppearance: this.planetAppearance, musicTrackId: this.musicTrackId
        });
        try { localStorage.setItem('mousie_nickname', this.nickname); } catch (_) {}
        const prog = _readJson(PROGRESS_KEY, {});
        prog.cheeseBank = this.storedCheese;
        prog.currentSkin = this.equippedSkinId;
        prog.skinsUnlocked = this.unlockedSkins.slice();
        _writeJson(PROGRESS_KEY, prog);
        this._listeners.forEach(fn => { try { fn(this); } catch (_) {} });
    }

    setNickname(name) {
        const clean = String(name || '').trim().slice(0, 16);
        if (!clean) return;
        this.nickname = clean;
        this._persist();
    }

    setPlanetAppearance(app) {
        this.planetAppearance = { ...this.planetAppearance, ...app };
        this._persist();
    }

    setMusicTrack(trackId) {
        if (!trackId) return;
        this.musicTrackId = String(trackId);
        this._persist();
    }

    setLocation(loc) { this.currentLocation = loc || 'space'; }

    getHomeSnapshot() {
        return {
            storedCheese: this.storedCheese,
            unlockedSkins: this.unlockedSkins.slice(),
            planetAppearance: this.planetAppearance
        };
    }

    addPocketCheese(amount = 1) {
        this._syncFromStorage();
        this.pocketCheese += Math.max(0, Math.round(amount));
        this._persist();
        return this.pocketCheese;
    }

    depositOnePocketCheese() {
        this._syncFromStorage();
        if (this.pocketCheese <= 0) return false;
        this.pocketCheese -= 1; this.storedCheese += 1;
        this._persist();
        return true;
    }

    buyAndEquipSkin(skinId) {
        this._syncFromStorage();
        const def = SKIN_CATALOG.find(s => s.id === skinId);
        if (!def) return { ok: false, reason: 'not_found' };
        if (!this.unlockedSkins.includes(skinId)) {
            if (this.storedCheese < def.price) return { ok: false, reason: 'no_cheese' };
            this.storedCheese -= def.price;
            this.unlockedSkins.push(skinId);
        }
        this.equippedSkinId = skinId;
        this._persist();
        return { ok: true };
    }
}

export const PlayerProfile = new PlayerProfileStore();

export function getPlayerSkinSprite(skinId = PlayerProfile.equippedSkinId) {
    const id = SKIN_CATALOG.some(s => s.id === skinId) ? skinId : 'blue';
    if (_spriteCache.has(id)) return _spriteCache.get(id);
    const def = SKIN_CATALOG.find(s => s.id === id) || SKIN_CATALOG[0];
    const slug = id.replace(/_/g, '-');
    const basePath = id === 'blue' ? 'assets/characters/transylvania/pi' : `assets/characters/transylvania/skins/${slug}`;
    const makeImg = (s = '') => { const img = new Image(); img.src = `${basePath}${s}.svg`; return img; };
    const entry = { id, name: def.name, bodyColor: def.body, svgUrl: `${basePath}.svg`, idle: makeImg(''), walk1: makeImg('-walk1'), walk2: makeImg('-walk2') };
    _spriteCache.set(id, entry);
    return entry;
}

if (typeof window !== 'undefined') {
    window.PlayerProfile = PlayerProfile;
    window.getPlayerSkinSprite = getPlayerSkinSprite;
}
