import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class Player extends Schema {
    constructor() {
        super();
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.facingRight = true;
        this.grounded = false;
        this.health = 100;
        this.character = 1;       // 1 = brown bunny (Pi), 2 = grey bunny (Pu)
        this.nickname = '';
        this.score = 0;
        this.isDying = false;
        this.animation = 'idle';  // 'idle' | 'walk' | 'jump'
        this.hookState = 'IDLE';  // 'IDLE' | 'FLYING' | 'ATTACHED'
        this.hookX = 0;
        this.hookY = 0;
        this.hookAnchorX = 0;
        this.hookAnchorY = 0;
        this.powerup = '';        // empty string = none
    }
}
type('number')(Player.prototype, 'x');
type('number')(Player.prototype, 'y');
type('number')(Player.prototype, 'vx');
type('number')(Player.prototype, 'vy');
type('boolean')(Player.prototype, 'facingRight');
type('boolean')(Player.prototype, 'grounded');
type('number')(Player.prototype, 'health');
type('number')(Player.prototype, 'character');
type('string')(Player.prototype, 'nickname');
type('number')(Player.prototype, 'score');
type('boolean')(Player.prototype, 'isDying');
type('string')(Player.prototype, 'animation');
type('string')(Player.prototype, 'hookState');
type('number')(Player.prototype, 'hookX');
type('number')(Player.prototype, 'hookY');
type('number')(Player.prototype, 'hookAnchorX');
type('number')(Player.prototype, 'hookAnchorY');
type('string')(Player.prototype, 'powerup');

export class Snowball extends Schema {
    constructor() {
        super();
        this.id = 0;
        this.x = 0;
        this.y = 0;
        this.vx = 0;
        this.vy = 0;
        this.hasFire = false;
    }
}
type('number')(Snowball.prototype, 'id');
type('number')(Snowball.prototype, 'x');
type('number')(Snowball.prototype, 'y');
type('number')(Snowball.prototype, 'vx');
type('number')(Snowball.prototype, 'vy');
type('boolean')(Snowball.prototype, 'hasFire');

export class Pickup extends Schema {
    constructor() {
        super();
        this.id = 0;
        this.x = 0;
        this.y = 0;
        this.type = '';
        this.active = true;
    }
}
type('number')(Pickup.prototype, 'id');
type('number')(Pickup.prototype, 'x');
type('number')(Pickup.prototype, 'y');
type('string')(Pickup.prototype, 'type');
type('boolean')(Pickup.prototype, 'active');

export class GameState extends Schema {
    constructor() {
        super();
        this.players = new MapSchema();
        this.snowballs = new ArraySchema();
        this.pickups = new ArraySchema();
        this.scoreHost = 0;
        this.scoreGuest = 0;
        this.tick = 0;
    }
}
type({ map: Player })(GameState.prototype, 'players');
type([Snowball])(GameState.prototype, 'snowballs');
type([Pickup])(GameState.prototype, 'pickups');
type('number')(GameState.prototype, 'scoreHost');
type('number')(GameState.prototype, 'scoreGuest');
type('number')(GameState.prototype, 'tick');
