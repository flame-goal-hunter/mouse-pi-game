// ============================================
// SoundKeys — event names emitted from gameplay code
// AudioManager subscribes to these on the EventBus and plays sounds.
// ============================================

export const SFX = {
    // Gameplay critical (feedback)
    FIRE_PIE:        'audio:firePie',
    HIT_ENEMY:       'audio:hitEnemy',
    HIT_WALL:        'audio:hitWall',
    TAKE_DAMAGE:     'audio:takeDamage',
    PLAYER_DASH:     'audio:dash',
    PLAYER_DEATH:    'audio:death',
    ENEMY_DEATH:     'audio:enemyDeath',
    BOSS_HIT:        'audio:bossHit',
    SLIME_SQUELCH:   'audio:slimeSquelch',

    // Pickups
    COLLECT_CHEESE:  'audio:collectCheese',
    COLLECT_HEART:   'audio:collectHeart',
    COLLECT_POWERUP: 'audio:collectPowerup',
    KEY_GRAB:        'audio:keyGrab',
    OPEN_CHEST:      'audio:openChest',
    CHEST_COINS:     'audio:chestCoins',
    LIGHT_TORCH:     'audio:lightTorch',

    // Stealth
    ALARM_TRIGGER:   'audio:alarmTrigger',
    SUSPICION_TICK:  'audio:suspicionTick',
    DISTRACTION_THUD: 'audio:distractionThud',
    GHOST_RUN:       'audio:ghostRun',

    // Story / boss
    BOSS_INTRO:      'audio:bossIntro',
    BOSS_PHASE:      'audio:bossPhase',
    WIN_STORY:       'audio:winStory',
    LOSE_STORY:      'audio:loseStory',

    // Floor events
    FLOOR_ENTER:     'audio:floorEnter',

    // Movement / world
    FOOTSTEP:        'audio:footstep',
    DOOR_OPEN:       'audio:doorOpen',

    // Ambience
    AMBIENCE_START:  'audio:ambienceStart',
    AMBIENCE_STOP:   'audio:ambienceStop'
};

export const UI = {
    BUTTON_CLICK:    'audio:ui:click',
    BUTTON_BACK:     'audio:ui:back',
    SHOP_BUY:        'audio:ui:buy',
    SHOP_DENY:       'audio:ui:deny',
    MENU_OPEN:       'audio:ui:menuOpen',
    MENU_CLOSE:      'audio:ui:menuClose',
    HEARTBEAT_TICK:  'audio:ui:heartbeat'
};

export const BGM = {
    DUNGEON:  'bgm:dungeon',
    KITCHEN:  'bgm:kitchen',
    LIBRARY:  'bgm:library',
    GARDEN:   'bgm:garden',
    THRONE:   'bgm:throne',
    MENU:     'bgm:menu'
};
