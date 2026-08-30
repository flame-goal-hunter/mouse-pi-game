// VibeRadar Game-Contract adapter for Mousie Pi (Phaser 3).
// Injected by the web-game driver at document start — the game itself never loads it
// (this file lives outside www/ so `cap sync` does not ship it). Zero edits to game code:
// the Phaser.Game instance is captured through a setter on window.Phaser.
(function () {
  'use strict';
  var GR = window.__guardrail;
  if (!GR) return;

  var NAV_CELL = 40;                   // DungeonScene.js: const NAV_CELL = 40
  var PROGRESS_KEY = 'mousiePi.progress.v1';
  var games = [];

  // ---- capture every Phaser.Game instance ----
  var realPhaser;
  Object.defineProperty(window, 'Phaser', {
    configurable: true, enumerable: true,
    get: function () { return realPhaser; },
    set: function (P) {
      realPhaser = P;
      if (P && P.Game && !P.Game.__guardrail) {
        var Orig = P.Game;
        function Game(cfg) { var g = new Orig(cfg); games.push(g); return g; }
        Game.prototype = Orig.prototype;
        Object.setPrototypeOf(Game, Orig);
        Game.__guardrail = true;
        P.Game = Game;
      }
    }
  });

  // ---- boot-time setup: seed saved progress before the game reads it (entry document only) ----
  var planSetup = (GR.plan && GR.plan.setup) || {};
  if (planSetup.progress != null && !sessionStorage.getItem('__guardrail.progress_applied')) {
    try {
      var patch = typeof planSetup.progress === 'string' ? JSON.parse(planSetup.progress) : planSetup.progress;
      var cur = {};
      try { cur = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {}; } catch (e) { cur = {}; }
      Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(cur));
      sessionStorage.setItem('__guardrail.progress_applied', '1');
    } catch (e) { console.error('[guardrail adapter] bad progress setup: ' + e.message); }
  }

  // ---- helpers ----
  var SCREEN_BY_KEY = { DungeonScene: 'dungeon', TransylvaniaScene: 'castle', MenuScene: 'main-menu',
                        GameScene: 'snowball', BootScene: 'boot' };
  function isMenuPage() { return location.pathname.indexOf('transylvania-menu') >= 0; }
  function game() { return games[0] || null; }
  function activeScene() {
    var g = game(); if (!g || !g.scene) return null;
    var scenes = g.scene.getScenes(true);
    return scenes.length ? scenes[scenes.length - 1] : null;
  }
  function dungeon() { var s = activeScene(); return s && s.scene.key === 'DungeonScene' ? s : null; }
  function screenId() {
    if (isMenuPage()) return 'menu';
    var s = activeScene();
    return s ? (SCREEN_BY_KEY[s.scene.key] || s.scene.key) : 'loading';
  }
  function alive(list) { return (list || []).filter(function (e) { return !e.dead; }); }

  // Canvas buttons = visible Text objects that are interactive themselves or sit on an
  // interactive hit area at the same position (drawGothicButton / menu cards / shop button).
  function canvasActions() {
    var s = activeScene(); if (!s || !s.children) return [];
    var list = s.children.list, texts = [], hits = [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o.visible || o.alpha === 0) continue;
      if (o.type === 'Text' && o.text && String(o.text).trim()) texts.push(o);
      if (o.input && o.input.enabled) hits.push(o);
    }
    var out = [];
    texts.forEach(function (t) {
      var own = t.input && t.input.enabled;
      var near = own || hits.some(function (h) { return Math.abs(h.x - t.x) < 4 && Math.abs(h.y - t.y) < 4; });
      if (near) out.push({ label: String(t.text).trim().split('\n')[0], x: t.x, y: t.y });
    });
    return out;
  }
  function pageCoords(x, y) {
    var g = game(), r = g.canvas.getBoundingClientRect();
    var sx = r.width / g.scale.width, sy = r.height / g.scale.height;
    return { x: r.left + x * sx, y: r.top + y * sy };   // UI objects are scrollFactor 0 => screen space
  }
  var held = {};
  function key(code, down) {
    if (!!held[code] === down) return;
    held[code] = down;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup',
      { code: code, key: code.replace('Key', '').toLowerCase(), keyCode: code.charCodeAt(3), bubbles: true }));
  }
  function releaseAll() { ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach(function (c) { key(c, false); }); }

  // ---- the contract ----
  GR.register({
    ready: function () {
      return new Promise(function (resolve) {
        (function poll() {
          if (isMenuPage()) { if (document.readyState !== 'loading') return resolve(); }
          else {
            var s = activeScene();
            if (s && s.scene.key !== 'BootScene' && (s.scene.key !== 'DungeonScene' || (s.player && s.state))) return resolve();
          }
          setTimeout(poll, 100);
        })();
      });
    },

    snapshot: function () {
      var d = dungeon(), st = {};
      if (d) {
        st = { mode: d.state, chapter: d.chapter, hp: d.player ? d.player.hp : null, maxHp: d.maxHp,
               hasKey: !!d.hasKey, cheese: d.cheeseTotal, enemies: alive(d.enemies).length,
               relics: d.collectedRelics, powerup: d.activePowerup, score: d.score, runMode: d.runMode };
      }
      return { screen: screenId(), actions: canvasActions().map(function (a) { return a.label; }), state: st };
    },

    perform: function (label) {
      var n = String(label).toLowerCase();
      var a = canvasActions().filter(function (x) { return x.label.toLowerCase().indexOf(n) >= 0; })[0];
      if (!a) return false;
      return { click: pageCoords(a.x, a.y) };
    },

    goTo: function (target, opts) {
      var d = dungeon();
      if (!d) return Promise.reject({ code: 'not_found', message: 'not in the dungeon (screen ' + screenId() + ')' });
      if (d.state !== 'play') return Promise.reject({ code: 'not_found', message: 'game is in state ' + d.state + ', not play' });
      var ARRIVE = { key: 24, exit: 30, enemy: 60, chest: 40 };
      function resolveTarget() {
        var p = d.player;
        function nearest(arr) {
          var best = null, bd = Infinity;
          (arr || []).forEach(function (o) { var dist = Math.hypot(o.x - p.x, o.y - p.y); if (dist < bd) { bd = dist; best = o; } });
          return best;
        }
        if (target === 'key') return d.keyPickup && !d.keyPickup.taken && !d.hasKey ? d.keyPickup : null;
        if (target === 'exit') return d.exit || null;
        if (target === 'enemy') return nearest(alive(d.enemies));
        if (target === 'chest') return nearest((d.chests || []).filter(function (c) { return !c.opened; }));
        return undefined;
      }
      var first = resolveTarget();
      if (first === undefined) return Promise.reject({ code: 'unsupported', message: 'unknown go_to target ' + target });
      if (!first) return Promise.reject({ code: 'not_found', message: 'no ' + target + ' on this floor' });
      var deadline = Date.now() + ((opts && opts.timeoutMs) || 30000);
      var arrive = ARRIVE[target];
      return new Promise(function (resolve, reject) {
        var path = null, plannedAt = 0;
        (function tick() {
          var p = d.player, t = resolveTarget();
          if (!t || (target === 'key' && d.hasKey) || (target === 'exit' && d.state === 'won')) { releaseAll(); return resolve(); }
          if (Math.hypot(t.x - p.x, t.y - p.y) <= arrive) { releaseAll(); return resolve(); }
          if (Date.now() > deadline) { releaseAll(); return reject({ code: 'timeout', message: 'did not reach ' + target }); }
          if (!path || Date.now() - plannedAt > 500) {
            var cells = d.findPath(p.x, p.y, t.x, t.y, 22);
            if (!cells) { releaseAll(); return reject({ code: 'no_path', message: 'no path to ' + target }); }
            path = cells.map(function (c) { return { x: (c.c + 0.5) * NAV_CELL, y: (c.r + 0.5) * NAV_CELL }; });
            path.push({ x: t.x, y: t.y });
            plannedAt = Date.now();
          }
          while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 12) path.shift();
          var wp = path[0], dx = wp.x - p.x, dy = wp.y - p.y;
          key('KeyD', dx > 6); key('KeyA', dx < -6); key('KeyS', dy > 6); key('KeyW', dy < -6);
          setTimeout(tick, 50);
        })();
      });
    },

    setup: function (opts) {
      var applied = [];
      if (opts.progress != null) applied.push('progress');            // applied at boot (above)
      var d = dungeon();
      if (d && opts.no_enemies) {
        alive(d.enemies).forEach(function (e) { e.dead = true; if (e.sprite && e.sprite.setVisible) e.sprite.setVisible(false); });
        var orig = d.spawnEnemy.bind(d);
        d.spawnEnemy = function () {
          var e = orig.apply(null, arguments);
          if (e) { e.dead = true; if (e.sprite && e.sprite.setVisible) e.sprite.setVisible(false); }
          return e;
        };
        applied.push('no_enemies');
      }
      if (d && opts.invulnerable) {
        d.events.on('update', function () { if (d.player) d.player.invulnTimer = 1e9; });
        applied.push('invulnerable');
      }
      return applied;
    }
  });

  // ---- events: forward every EventBus emit as-is (audio:keyGrab, audio:takeDamage, ...) ----
  if (!isMenuPage()) {
    import('/js/audio/EventBus.js').then(function (m) {
      var bus = m.bus, origEmit = bus.emit.bind(bus);
      bus.emit = function (name, data) { GR.emit(name, data); return origEmit(name, data); };
    }).catch(function (e) { console.warn('[guardrail adapter] EventBus not available: ' + e.message); });
  }
})();
