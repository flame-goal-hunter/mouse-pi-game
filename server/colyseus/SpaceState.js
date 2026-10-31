// ============================================================================
// SpaceState.js — Схема состояния комнаты Космоса (@colyseus/schema)
// ============================================================================

import { Schema, MapSchema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
    constructor() {
        super();
        this.id = '';
        this.sessionId = '';
        this.nickname = 'Мышонок Пи';
        this.skinId = 'blue';
        this.activityStatus = 'space';
        this.x = 0;
        this.y = 165;
        this.vx = 0;
        this.vy = 0;
        this.angle = -1.57;
        this.isThrusting = false;
        this.isTurbo = false;
        this.paintColor = '';
        this.paintTimer = 0;
        this.storedCheese = 50;
        this.planetBiome = 'cheese';
        this.planetRing = 'none';
        this.homeAngle = 0;
        this.facing = 1;
        this.moving = false;
    }
}
type('string')(PlayerState.prototype, 'id');
type('string')(PlayerState.prototype, 'sessionId');
type('string')(PlayerState.prototype, 'nickname');
type('string')(PlayerState.prototype, 'skinId');
type('string')(PlayerState.prototype, 'activityStatus');
type('number')(PlayerState.prototype, 'x');
type('number')(PlayerState.prototype, 'y');
type('number')(PlayerState.prototype, 'vx');
type('number')(PlayerState.prototype, 'vy');
type('number')(PlayerState.prototype, 'angle');
type('boolean')(PlayerState.prototype, 'isThrusting');
type('boolean')(PlayerState.prototype, 'isTurbo');
type('string')(PlayerState.prototype, 'paintColor');
type('number')(PlayerState.prototype, 'paintTimer');
type('number')(PlayerState.prototype, 'storedCheese');
type('string')(PlayerState.prototype, 'planetBiome');
type('string')(PlayerState.prototype, 'planetRing');
type('number')(PlayerState.prototype, 'homeAngle');
type('number')(PlayerState.prototype, 'facing');
type('boolean')(PlayerState.prototype, 'moving');

export class BallState extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 110;
        this.vx = 0;
        this.vy = 0;
        this.angle = 0;
        this.scoreBlue = 0;
        this.scorePink = 0;
    }
}
type('number')(BallState.prototype, 'x');
type('number')(BallState.prototype, 'y');
type('number')(BallState.prototype, 'vx');
type('number')(BallState.prototype, 'vy');
type('number')(BallState.prototype, 'angle');
type('number')(BallState.prototype, 'scoreBlue');
type('number')(BallState.prototype, 'scorePink');

export class ProjectileState extends Schema {
    constructor() {
        super();
        this.id = '';
        this.ownerId = '';
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.color = '#f472b6';
    }
}
type('string')(ProjectileState.prototype, 'id');
type('string')(ProjectileState.prototype, 'ownerId');
type('number')(ProjectileState.prototype, 'x');
type('number')(ProjectileState.prototype, 'y');
type('number')(ProjectileState.prototype, 'vx');
type('number')(ProjectileState.prototype, 'vy');
type('string')(ProjectileState.prototype, 'color');

export class CheeseState extends Schema {
    constructor() {
        super();
        this.id = '';
        this.x = 0;
        this.y = 0;
    }
}
type('string')(CheeseState.prototype, 'id');
type('number')(CheeseState.prototype, 'x');
type('number')(CheeseState.prototype, 'y');

export class SpaceState extends Schema {
    constructor() {
        super();
        this.serverTick = 0;
        this.players = new MapSchema();
        this.ball = new BallState();
        this.projectiles = new MapSchema();
        this.spaceCheese = new MapSchema();
    }
}
type('number')(SpaceState.prototype, 'serverTick');
type({ map: PlayerState })(SpaceState.prototype, 'players');
type(BallState)(SpaceState.prototype, 'ball');
type({ map: ProjectileState })(SpaceState.prototype, 'projectiles');
type({ map: CheeseState })(SpaceState.prototype, 'spaceCheese');

