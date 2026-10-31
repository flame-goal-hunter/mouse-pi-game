// ============================================================================
// RemoteSpaceRenderer.js — Пояс личных Домашних планет (моя + друзья) с Горой Сыра,
// уникальным planetAppearance, табличкой со скином и плавные чужие ракеты (lerp)
// ============================================================================

import { SpaceNetwork } from './SpaceNetwork.js';
import { PlayerProfile, getPlayerSkinSprite } from '../core/PlayerProfile.js';
import { getPersonalPlanetCoords, getDefaultAppearance, drawPersonalPlanetVisual } from './PersonalPlanetSystem.js';

export class RemoteSpaceRenderer {
    getMyHomePlanet() {
        const myId = PlayerProfile.playerId;
        const pos = getPersonalPlanetCoords(myId);
        const app = PlayerProfile.planetAppearance || getDefaultAppearance(myId, PlayerProfile.nickname);
        return {
            id: `home_planet_${myId}`,
            ownerId: myId,
            ownerNick: PlayerProfile.nickname,
            ownerSkinId: PlayerProfile.equippedSkinId,
            homeSnapshot: PlayerProfile.getHomeSnapshot(),
            planetAppearance: app,
            name: `Планета ${PlayerProfile.nickname}`,
            subtitle: `🧀 На моём складе: ${PlayerProfile.storedCheese} · В багажнике: ${PlayerProfile.pocketCheese}`,
            badge: 'МОЙ ДОМ 🏠',
            actionLabel: 'ДОМОЙ!',
            actionTheme: 'green',
            x: pos.x,
            y: pos.y,
            radius: 76,
            dockRadius: 175,
            coreColor: app.baseColor || '#facc15',
            isHomePlanet: true,
            isMyHome: true,
            ownerIsHome: false,
            locked: false
        };
    }

    getPersonalPlanets() {
        const map = new Map();
        const myPlanet = this.getMyHomePlanet();
        map.set(PlayerProfile.playerId, myPlanet);

        for (const [id, c] of SpaceNetwork.cachedHomes) {
            if (id === PlayerProfile.playerId) continue;
            const pos = getPersonalPlanetCoords(id);
            const snap = c.homeSnapshot || { storedCheese: 50, unlockedSkins: ['blue'] };
            const app = snap.planetAppearance || getDefaultAppearance(id, c.nickname);
            map.set(id, {
                id: `home_planet_${id}`, ownerId: id,
                ownerNick: c.nickname || 'Друг Пи', ownerSkinId: c.equippedSkinId || 'blue',
                homeSnapshot: snap, planetAppearance: app,
                name: `Планета ${c.nickname || 'Пи'}`,
                subtitle: `🧀 Гора сыра: ${snap.storedCheese || 0} · Скинов: ${(snap.unlockedSkins || ['blue']).length}`,
                badge: '🛸 ДОМ ИГРОКА', actionLabel: 'В ГОСТИ!', actionTheme: 'cyan',
                x: pos.x, y: pos.y, radius: 68, dockRadius: 165,
                coreColor: app.baseColor || '#38bdf8',
                isFriendHome: true, ownerIsHome: false, locked: false
            });
        }

        for (const p of SpaceNetwork.getOnlinePeers()) {
            const pos = getPersonalPlanetCoords(p.playerId);
            const snap = p.homeSnapshot || { storedCheese: 50, unlockedSkins: ['blue'] };
            const app = snap.planetAppearance || getDefaultAppearance(p.playerId, p.nickname);
            const ownerIsHome = p.currentLocation === 'home' || p.currentLocation === `home:${p.playerId}`;
            map.set(p.playerId, {
                id: `home_planet_${p.playerId}`, ownerId: p.playerId,
                ownerNick: p.nickname || 'Пи', ownerSkinId: p.equippedSkinId || 'blue',
                homeSnapshot: snap, planetAppearance: app,
                name: `Планета ${p.nickname || 'Пи'}`,
                subtitle: `${ownerIsHome ? '🟢 Хозяин сейчас дома! · ' : ''}🧀 На складе: ${snap.storedCheese || 0}`,
                badge: ownerIsHome ? '🟢 Дома!' : '🛸 ДОМ ИГРОКА',
                actionLabel: 'В ГОСТИ!', actionTheme: 'cyan',
                x: pos.x, y: pos.y, radius: 68, dockRadius: 165,
                coreColor: app.baseColor || '#38bdf8',
                isFriendHome: true, ownerIsHome, locked: false
            });
        }
        return Array.from(map.values());
    }

    draw(ctx, timeSec, activePlanetId) {
        for (const hp of this.getPersonalPlanets()) {
            this._drawHomePlanet(ctx, hp, timeSec, activePlanetId === hp.id);
        }
        for (const peer of SpaceNetwork.getOnlinePeers()) {
            if (peer.currentLocation === 'space') peer.draw(ctx, timeSec);
        }
    }

    _drawHomePlanet(ctx, hp, timeSec, isHovered) {
        const bob = Math.sin(timeSec * 1.9 + hp.x * 0.01) * 5;
        ctx.save();
        ctx.translate(hp.x, hp.y + bob);

        if (isHovered || hp.isMyHome || hp.ownerIsHome) {
            ctx.save();
            ctx.rotate(timeSec * 1.1);
            ctx.strokeStyle = hp.isMyHome ? '#facc15' : (hp.ownerIsHome ? '#4ade80' : '#22d3ee');
            ctx.lineWidth = isHovered ? 4 : 2.5;
            ctx.setLineDash([14, 9]);
            ctx.beginPath(); ctx.arc(0, 0, hp.radius + 24, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }

        drawPersonalPlanetVisual(ctx, hp.radius, hp.planetAppearance, hp.homeSnapshot?.storedCheese || 0, timeSec);

        // Parked rocket + "Дома!" badge when owner is home
        if (hp.ownerIsHome) {
            const a = timeSec * 1.3;
            ctx.save();
            ctx.translate(Math.cos(a) * (hp.radius + 28), Math.sin(a) * (hp.radius + 28));
            ctx.rotate(a + Math.PI / 2);
            ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, 0, 12, 6.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
        }

        // Owner nameplate with skin avatar + "МОЙ ДОМ 🏠" or "Планета [Ник]"
        const skin = getPlayerSkinSprite(hp.ownerSkinId);
        const topLabel = hp.isMyHome ? 'МОЙ ДОМ 🏠' : hp.badge;
        ctx.font = '900 12px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = hp.isMyHome ? '#fde047' : (hp.ownerIsHome ? '#4ade80' : '#38bdf8');
        ctx.fillText(topLabel, 0, hp.radius + 22);

        const title = hp.name;
        ctx.font = '900 14px "Nunito", sans-serif';
        const pillW = Math.max(115, ctx.measureText(title).width + 42);
        const py = hp.radius + 28;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = hp.isMyHome ? '#facc15' : (hp.planetAppearance?.baseColor || '#38bdf8');
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(-pillW / 2, py, pillW, 26, 13); ctx.fill(); ctx.stroke();

        if (skin.idle && skin.idle.complete && skin.idle.naturalWidth > 0) {
            ctx.drawImage(skin.idle, -pillW / 2 + 5, py + 2, 22, 22);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillText(title, 10, py + 18);
        ctx.restore();
    }
}
