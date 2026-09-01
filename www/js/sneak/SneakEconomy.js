// ============================================
// SNEAK ECONOMY — начисление и потеря сыра в режиме «Тихая лапка».
// Банк сыра общий с остальными режимами; здесь считается только ночь.
// ============================================

import { SNEAK } from './SneakMetrics.js';

export const LOOT_BONUS = 40;
export const NEVER_SEEN_BONUS = 30;
export const FIRST_CLEAR_BONUS = 50;
export const PIE_PRICE = 15;

// Поимка забирает половину сыра, набранного за текущую ночь.
// Сыр, унесённый в прошлые ночи, уже лежит в банке и не затрагивается.
export function cheeseOnCapture(carriedThisNight) {
    const lost = Math.floor(carriedThisNight * SNEAK.CAPTURE_LOSS);
    return { lost, kept: carriedThisNight - lost };
}

export function nightReward({ collected, tookLoot, neverSeen, firstClear }) {
    const parts = { collected, loot: 0, neverSeen: 0, firstClear: 0 };
    if (tookLoot) parts.loot = LOOT_BONUS;
    if (neverSeen) parts.neverSeen = NEVER_SEEN_BONUS;
    if (firstClear) parts.firstClear = FIRST_CLEAR_BONUS;
    const total = parts.collected + parts.loot + parts.neverSeen + parts.firstClear;
    return { ...parts, total };
}
