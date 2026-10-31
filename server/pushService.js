// ============================================================================
// pushService.js — Сервис Web Push уведомлений (VAPID) и реестр Домашних планет
// Хранит игроков (playerId, nickname, skinId, planetAppearance, storedCheese, pushSubscription)
// ============================================================================

import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const VAPID_FILE = join(DIR, 'vapid.json');
const PLAYERS_FILE = join(DIR, 'players_db.json');

const playersRegistry = new Map();
let vapidKeys = null;

function initVapid() {
    try {
        if (existsSync(VAPID_FILE)) {
            vapidKeys = JSON.parse(readFileSync(VAPID_FILE, 'utf8'));
        }
    } catch (_) {}
    if (!vapidKeys?.publicKey || !vapidKeys?.privateKey) {
        vapidKeys = webpush.generateVAPIDKeys();
        try { writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2)); } catch (_) {}
    }
    webpush.setVapidDetails('mailto:pilot@mousie-pi.game', vapidKeys.publicKey, vapidKeys.privateKey);
}

function loadPlayersDb() {
    try {
        if (!existsSync(PLAYERS_FILE)) return;
        const list = JSON.parse(readFileSync(PLAYERS_FILE, 'utf8'));
        if (Array.isArray(list)) {
            for (const p of list) {
                if (p?.playerId) playersRegistry.set(p.playerId, p);
            }
        }
    } catch (_) {}
}

let saveTimer = null;
function scheduleSaveDb() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            const list = Array.from(playersRegistry.values()).slice(-200);
            writeFileSync(PLAYERS_FILE, JSON.stringify(list, null, 2));
        } catch (_) {}
    }, 1200);
}

initVapid();
loadPlayersDb();

export function getVapidPublicKey() {
    return vapidKeys?.publicKey || '';
}

export function upsertPlayerFromPacket(pkt) {
    if (!pkt?.playerId) return;
    const prev = playersRegistry.get(pkt.playerId) || { playerId: pkt.playerId };
    const snap = pkt.homeSnapshot || prev.homeSnapshot || { storedCheese: 50, unlockedSkins: ['blue'] };
    const next = {
        ...prev,
        playerId: pkt.playerId,
        nickname: pkt.nickname || prev.nickname || 'Мышонок Пи',
        skinId: pkt.skinId || pkt.equippedSkinId || prev.skinId || 'blue',
        equippedSkinId: pkt.equippedSkinId || pkt.skinId || prev.equippedSkinId || 'blue',
        planetAppearance: snap.planetAppearance || prev.planetAppearance || null,
        storedCheese: snap.storedCheese ?? prev.storedCheese ?? 50,
        homeSnapshot: snap,
        pushSubscription: pkt.pushSubscription?.endpoint ? pkt.pushSubscription : (prev.pushSubscription || null),
        updatedAt: Date.now()
    };
    playersRegistry.set(pkt.playerId, next);
    scheduleSaveDb();
}

export function savePushSubscription(playerId, subscription, meta = {}) {
    if (!playerId || !subscription?.endpoint) return false;
    const prev = playersRegistry.get(playerId) || { playerId };
    playersRegistry.set(playerId, {
        ...prev,
        nickname: meta.nickname || prev.nickname || 'Мышонок Пи',
        skinId: meta.skinId || prev.skinId || 'blue',
        equippedSkinId: meta.skinId || prev.equippedSkinId || 'blue',
        pushSubscription: subscription,
        updatedAt: Date.now()
    });
    scheduleSaveDb();
    return true;
}

export function getAllSavedPlayers() {
    return Array.from(playersRegistry.values()).map(({ pushSubscription, ...pub }) => ({
        ...pub,
        hasPush: Boolean(pushSubscription?.endpoint)
    }));
}

export async function sendInvitePush({ fromId, fromNickname, toId }) {
    const target = playersRegistry.get(toId);
    if (!target?.pushSubscription?.endpoint) return { pushed: false, reason: 'no_subscription' };
    const senderName = (fromNickname || 'Друг Пи').slice(0, 24);
    const payload = JSON.stringify({
        title: '🐭 Мышонок Пи — Зовут в космос!',
        body: `🚀 ${senderName} прилетел к твоей планете и зовет тебя играть!`,
        fromId,
        fromNickname: senderName,
        toId,
        url: './'
    });
    try {
        await webpush.sendNotification(target.pushSubscription, payload, { TTL: 300, urgency: 'high' });
        return { pushed: true };
    } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
            target.pushSubscription = null;
            scheduleSaveDb();
        }
        return { pushed: false, reason: err?.message || 'push_failed' };
    }
}

