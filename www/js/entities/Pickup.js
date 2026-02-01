// ============================================
// PICKUP - Collectible power-ups (Emoji-based)
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
            fontSize: '28px'
        }).setOrigin(0.5);
        this.emoji.setDepth(5);

        // Create invisible Matter.js sensor for collision
        this.sensor = scene.matter.add.circle(x, y, 18, {
            isSensor: true,
            isStatic: true,
            label: `pickup-${type}`
        });

        // Link sensor to this pickup for collision detection
        this.sensor.gameObject = this.emoji;
        this.emoji.pickup = this;
        this.sensor.pickup = this;

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

        // Play sound with spatial audio (using jump sound as pickup sound)
        if (this.scene.playSpatialSound) {
            this.scene.playSpatialSound('sfx-jump', this.emoji.x, this.emoji.y, 0.5);
        }

        // Apply effect (null character = network-triggered, visual only)
        if (character) {
            this.applyEffect(character);
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
        if (this.sensor && this.scene) {
            this.scene.matter.world.remove(this.sensor);
            this.sensor = null;
        }
    }
}

// Static auto-increment ID counter
Pickup._nextId = 0;
