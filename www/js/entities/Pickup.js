// ============================================
// PICKUP - Collectible power-ups (Emoji-based)
// v28: No Rapier sensor - collision handled in GameScene.processCollisions()
// ============================================

import { PICKUPS, GAME } from '../config.js';

export class Pickup {
    constructor(scene, x, y, type, id) {
        this.scene = scene;
        this.type = type;
        this.id = id !== undefined ? id : Pickup._nextId++;
        this.config = PICKUPS[type.toUpperCase()] || PICKUPS.HEALTH;
        this.collected = false;
        this.startY = y;

        // Create emoji text
        this.emoji = scene.add.text(x, y, this.config.emoji, {
            fontSize: '28px',
            padding: { top: 4 }
        }).setOrigin(0.5);
        this.emoji.setDepth(15);

        // Link pickup reference on emoji (for collision lookup)
        this.emoji.pickup = this;

        // Floating animation
        scene.tweens.add({
            targets: this.emoji,
            y: y - 15,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Gentle rotation/pulse
        scene.tweens.add({
            targets: this.emoji,
            scale: { from: 1, to: 1.15 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    /**
     * Called when a character collects this pickup
     */
    collect(character) {
        if (this.collected) return;
        this.collected = true;

        // Play distinct pickup sound with spatial audio
        if (this.scene.playSpatialSound) {
            const sfxKey = this.type === 'health' ? 'sfx-heart' : 'sfx-powerup';
            this.scene.playSpatialSound(sfxKey, this.emoji.x, this.emoji.y, 0.65);
        }

        // Apply effect (null character = network-triggered, visual only)
        if (character) {
            this.applyEffect(character);
            if (this.scene.onPickupCollected) {
                this.scene.onPickupCollected(character, this.type, this.config, this.emoji.x, this.emoji.y);
            }
        }

        // Collection animation
        this.scene.tweens.add({
            targets: this.emoji,
            scale: 2,
            alpha: 0,
            y: this.emoji.y - 50,
            duration: 300,
            ease: 'Power2',
            onComplete: () => {
                this.destroy();
            }
        });
    }

    /**
     * Apply the pickup effect to the character
     */
    applyEffect(character) {
        const cfg = this.config;

        switch (this.type) {
            case 'health':
                const currentHp = character.getData('health');
                const newHp = Math.min(GAME.MAX_HEALTH, currentHp + cfg.heal);
                character.setData('health', newHp);
                break;

            case 'fire':
            case 'speed':
            case 'shield':
            case 'doublejump':
                // Add timed powerup effect
                if (this.scene.addPowerup) {
                    this.scene.addPowerup(character, this.type, cfg);
                }
                break;
        }
    }

    /**
     * Check if pickup is still active
     */
    isActive() {
        return this.emoji && this.emoji.active && !this.collected;
    }

    /**
     * Destroy the pickup
     */
    destroy() {
        if (this.emoji) {
            this.emoji.destroy();
            this.emoji = null;
        }
    }
}

// Static auto-increment ID counter
Pickup._nextId = 0;
