// ============================================================================
// RemoteSpaceRenderer.js — Плавная отрисовка чужих ракет в космосе (lerp)
// и сектора личных Домашних планет друзей («Дом игрока [Ник]») для полётов в гости
// ============================================================================

import { SpaceNetwork } from './SpaceNetwork.js';
import { getPlayerSkinSprite } from '../core/PlayerProfile.js';

export class RemoteSpaceRenderer {
    getFriendPlanets() {
        const map = new Map();
        for (const [id, c] of SpaceNetwork.cachedHomes) {
            map.set(id, {
                id: `friend_home:${id}`,
                ownerId: id,
                ownerNick: c.nickname || 'Друг Пи',
                ownerSkinId: c.equippedSkinId || 'blue',
                homeSnapshot: c.homeSnapshot || { storedCheese: 50, unlockedSkins: ['blue'] },
                name: `Дом игрока ${c.nickname || 'Пи'}`,
                subtitle: `🧀 Гора сыра: ${c.homeSnapshot?.storedCheese || 0} · Скинов: ${(c.homeSnapshot?.unlockedSkins || ['blue']).length}`,
                badge: '🛸 ДОМ ДРУГА',
                actionLabel: 'В ГОСТИ!',
                x: c.homeX,
                y: c.homeY,
                radius: 64,
                dockRadius: 155,
                coreColor: '#38bdf8',
                isFriendHome: true,
                ownerIsHome: false,
                locked: false
            });
        }

        for (const p of SpaceNetwork.getOnlinePeers()) {
            const pos = SpaceNetwork.getFriendPlanetPos(p.playerId);
            const snap = p.homeSnapshot || { storedCheese: 50, unlockedSkins: ['blue'] };
            const ownerIsHome = p.currentLocation === 'home' || p.currentLocation === `home:${p.playerId}`;
            map.set(p.playerId, {
                id: `friend_home:${p.playerId}`,
                ownerId: p.playerId,
                ownerNick: p.nickname || 'Пи',
                ownerSkinId: p.equippedSkinId || 'blue',
                homeSnapshot: snap,
                name: `Дом игрока ${p.nickname || 'Пи'}`,
                subtitle: `${ownerIsHome ? '🟢 Хозяин сейчас дома! · ' : ''}🧀 Сыра на складе: ${snap.storedCheese || 0}`,
                badge: ownerIsHome ? '🏠 ХОЗЯИН ДОМА!' : '🛸 ДОМ ИГРОКА',
                actionLabel: 'В ГОСТИ!',
                x: pos.x,
                y: pos.y,
                radius: 64,
                dockRadius: 155,
                coreColor: ownerIsHome ? '#4ade80' : '#38bdf8',
                isFriendHome: true,
                ownerIsHome,
                locked: false
            });
        }
        return Array.from(map.values());
    }

    draw(ctx, timeSec, activePlanetId) {
        const friendPlanets = this.getFriendPlanets();
        for (const fp of friendPlanets) {
            this._drawFriendPlanet(ctx, fp, timeSec, activePlanetId === fp.id);
        }

        for (const peer of SpaceNetwork.getOnlinePeers()) {
            if (peer.currentLocation !== 'space') continue;
            this._drawRemoteRocket(ctx, peer, timeSec);
        }
    }

    _drawFriendPlanet(ctx, fp, timeSec, isHovered) {
        const bob = Math.sin(timeSec * 2 + fp.x * 0.01) * 5;
        ctx.save();
        ctx.translate(fp.x, fp.y + bob);

        if (isHovered || fp.ownerIsHome) {
            ctx.save();
            ctx.rotate(timeSec * 1.2);
            ctx.strokeStyle = fp.ownerIsHome ? '#4ade80' : '#38bdf8';
            ctx.lineWidth = isHovered ? 4 : 2.5;
            ctx.setLineDash([12, 8]);
            ctx.beginPath();
            ctx.arc(0, 0, fp.radius + 20, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        const atmo = ctx.createRadialGradient(0, 0, fp.radius * 0.7, 0, 0, fp.radius * 1.45);
        atmo.addColorStop(0, fp.ownerIsHome ? 'rgba(74, 222, 128, 0.38)' : 'rgba(56, 189, 248, 0.32)');
        atmo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = atmo;
        ctx.beginPath(); ctx.arc(0, 0, fp.radius * 1.45, 0, Math.PI * 2); ctx.fill();

        const skin = getPlayerSkinSprite(fp.ownerSkinId);
        if (skin.idle && skin.idle.complete && skin.idle.naturalWidth > 0) {
            ctx.save();
            ctx.translate(fp.radius * 0.5, -fp.radius * 0.65);
            ctx.rotate(0.22);
            ctx.drawImage(skin.idle, -22, -22, 44, 44);
            ctx.restore();
        }

        const bodyG = ctx.createRadialGradient(-18, -18, 6, 0, 0, fp.radius);
        bodyG.addColorStop(0, '#fde047');
        bodyG.addColorStop(0.65, '#f59e0b');
        bodyG.addColorStop(1, '#78350f');
        ctx.fillStyle = bodyG;
        ctx.beginPath(); ctx.arc(0, 0, fp.radius, 0, Math.PI * 2); ctx.fill();

        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, fp.radius - 2, 0, Math.PI * 2); ctx.stroke();

        ctx.font = '900 11.5px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = fp.ownerIsHome ? '#4ade80' : '#7dd3fc';
        ctx.fillText(fp.badge, 0, fp.radius + 20);
        ctx.font = '900 14px "Nunito", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fp.name, 0, fp.radius + 37);
        ctx.restore();
    }

    _drawRemoteRocket(ctx, peer, timeSec) {
        const skin = getPlayerSkinSprite(peer.equippedSkinId);
        ctx.save();
        ctx.translate(peer.rx, peer.ry);

        ctx.save();
        ctx.rotate(peer.rAngle);

        // Exhaust flame
        const flameR = 6 + Math.sin(timeSec * 24) * 2.5;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath(); ctx.arc(-25, 0, flameR, 0, Math.PI * 2); ctx.fill();

        // Fins & hull
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.moveTo(-9, -12); ctx.lineTo(-22, -21); ctx.lineTo(-16, -7); ctx.closePath();
        ctx.moveTo(-9, 12);  ctx.lineTo(-22, 21);  ctx.lineTo(-16, 7);  ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#f1f5f9';
        ctx.strokeStyle = skin.bodyColor || '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(2, 0, 23, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Porthole with remote player's equipped skin
        ctx.fillStyle = '#0f172a';
        ctx.beginPath(); ctx.arc(3, 0, 8.5, 0, Math.PI * 2); ctx.fill();
        if (skin.idle && skin.idle.complete && skin.idle.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath(); ctx.arc(3, 0, 8, 0, Math.PI * 2); ctx.clip();
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(skin.idle, -8, -10, 16, 16);
            ctx.restore();
        }
        ctx.restore();

        // Nickname tag above remote rocket
        ctx.font = '900 12px "Nunito", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        const w = Math.max(48, ctx.measureText(peer.nickname || 'Пи').width + 14);
        ctx.beginPath(); ctx.roundRect(-w / 2, -36, w, 18, 9); ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.fillText(peer.nickname || 'Пи', 0, -23);
        ctx.restore();
    }
}

