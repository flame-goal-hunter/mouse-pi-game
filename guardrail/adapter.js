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
        var Game = function (cfg) { var g = new Orig(cfg); games.push(g); return g; };
        Game.prototype = Orig.prototype;
        Object.setPrototypeOf(Game, Orig);
        Game.__guardrail = true;
        P.Game = Game;
      }
    }
  });

  // ---- boot-time setup: seed saved progress before the game reads it (entry document only) ----
  var planSetup = (GR.plan && GR.plan.setup) || {};
  var progressApplied = sessionStorage.getItem('__guardrail.progress_applied') === '1';
  if (planSetup.progress != null && !progressApplied) {
    try {
      var patch = typeof planSetup.progress === 'string' ? JSON.parse(planSetup.progress) : planSetup.progress;
      var cur = {};
      try { cur = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}') || {}; } catch (e) { cur = {}; }
      Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(cur));
      sessionStorage.setItem('__guardrail.progress_applied', '1');
      progressApplied = true;
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
  function hideEnemy(e) {
    ['sprite', 'shadow', 'behaviorIcon', 'coneGfx', 'mimicDecoy'].forEach(function (k) {
      var o = e[k]; if (o && typeof o.setVisible === 'function') o.setVisible(false);
    });
  }

  // Canvas buttons = visible Text objects that are interactive themselves or sit on an
  // interactive hit area at the same position (drawGothicButton / menu cards / shop button).
  // DungeonScene._pinFixed() moves all screen-space UI into Containers, so walk them too,
  // accumulating each container's offset to get screen-space positions.
  function canvasActions() {
    var s = activeScene(); if (!s || !s.children) return [];
    var texts = [], hits = [];
    function walk(list, ox, oy) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!o.visible || o.alpha === 0) continue;
        if (o.type === 'Container') { walk(o.list || [], ox + o.x, oy + o.y); continue; }
        var x = ox + o.x, y = oy + o.y;
        if (o.type === 'Text' && o.text && String(o.text).trim()) texts.push({ o: o, x: x, y: y });
        if (o.input && o.input.enabled) hits.push({ x: x, y: y });
      }
    }
    walk(s.children.list, 0, 0);
    var out = [];
    texts.forEach(function (t) {
      var own = t.o.input && t.o.input.enabled;
      var near = own || hits.some(function (h) { return Math.abs(h.x - t.x) < 4 && Math.abs(h.y - t.y) < 4; });
      if (near) out.push({ label: String(t.o.text).trim().split('\n')[0], x: t.x, y: t.y });
    });
    return out;
  }
  // Screen-space UI (scrollFactor 0) maps 1:1 onto CSS pixels: the game sizes its canvas as
  // cssW*dpr with zoom 1/dpr and the camera zoomed by dpr, and the driver runs at dpr 1.
  function pageCoords(x, y) {
    var g = game(), r = g.canvas.getBoundingClientRect();
    var sx = r.width / g.scale.width, sy = r.height / g.scale.height;
    return { x: r.left + x * sx, y: r.top + y * sy };
  }
  var held = {};
  function key(code, down) {
    if (!!held[code] === down) return;
    held[code] = down;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup',
      { code: code, key: code.replace('Key', '').toLowerCase(), keyCode: code.charCodeAt(3), bubbles: true }));
  }
  function releaseAll() { ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach(function (c) { key(c, false); }); }

  // Runtime setup flags are applied per DungeonScene instance (the menu entry reaches the
  // dungeon only after a navigation, so the driver's single setup() call may precede it).
  function applyDungeonSetup(d) {
    if (!d || d.__guardrailSetup) return;
    d.__guardrailSetup = true;
    if (planSetup.no_enemies) {
      alive(d.enemies).forEach(function (e) { e.dead = true; hideEnemy(e); });
      var orig = d.spawnEnemy.bind(d);
      d.spawnEnemy = function () {
        var e = orig.apply(null, arguments);
        if (e) { e.dead = true; hideEnemy(e); }
        return e;
      };
    }
    if (planSetup.invulnerable) {
      d.events.on('update', function () { if (d.player) d.player.invulnTimer = 1e9; });
    }
  }

  // ---- the contract ----
  GR.register({
    ready: function () {
      return new Promise(function (resolve) {
        (function poll() {
          if (isMenuPage()) { if (document.readyState !== 'loading') return resolve(); }
          else {
            var s = activeScene();
            if (s && s.scene.key !== 'BootScene' && (s.scene.key !== 'DungeonScene' || (s.player && s.state))) {
              applyDungeonSetup(dungeon());
              return resolve();
            }
          }
          setTimeout(poll, 100);
        })();
      });
    },

    snapshot: function () {
      var d = dungeon(), st = {};
      if (d) {
        st = { mode: d.state, chapter: d.chapter, hp: d.player ? d.player.hp : null, maxHp: d.maxHp,
               hasKey: !!d.hasKey, cheese: d.cheeseGot, cheeseTotal: d.cheeseTotal,
               enemies: alive(d.enemies).length, relics: d.collectedRelics, powerup: d.activePowerup,
               score: d.score, runMode: d.runMode };
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
      var ARRIVE = { key: 24, exit: 30, enemy: 35, chest: 40 };   // all inside the game's own trigger radii
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
        if (target === 'chest') return nearest((d.chests || []).filter(function (c) { return !c.opened && c.sprite && c.sprite.scene; }));
        return undefined;
      }
      var first = resolveTarget();
      if (first === undefined) return Promise.reject({ code: 'unsupported', message: 'unknown go_to target ' + target });
      if (!first) return Promise.reject({ code: 'not_found', message: 'no ' + target + ' on this floor' });
      var deadline = Date.now() + ((opts && opts.timeoutMs) || 30000);
      var arrive = ARRIVE[target];
      // The path is 4-connected over 40 px cells while the player is a 22 px circle, so it is
      // steered ONE axis at a time (diagonal input into a corner is how the player gets stuck):
      // move along the dominant axis to the next cell centre, then the other one.
      var TICK_MS = 25, CAPTURE = 12, TOL = 4;
      return new Promise(function (resolve, reject) {
        var path = null, plannedAt = 0, planFailures = 0, clearance = 0;
        var lastPos = null, stuckSince = 0, nudgeUntil = 0, nudge = 1;
        function done(fn, arg) { releaseAll(); fn(arg); }
        (function tick() {
          if (dungeon() !== d) return done(reject, { code: 'not_found', message: 'left the dungeon during go_to ' + target });
          var p = d.player, t = resolveTarget(), now = Date.now();
          if (!t || (target === 'key' && d.hasKey) || (target === 'exit' && d.state === 'won')) return done(resolve);
          if (d.state !== 'play') return done(reject, { code: 'not_found', message: 'game state became ' + d.state + ' during go_to ' + target });
          if (Math.hypot(t.x - p.x, t.y - p.y) <= arrive) return done(resolve);
          if (now > deadline) return done(reject, { code: 'timeout', message: 'did not reach ' + target });
          // stuck detection: no displacement for 500 ms -> replan and nudge sideways briefly
          if (lastPos && Math.hypot(p.x - lastPos.x, p.y - lastPos.y) < 3) {
            if (!stuckSince) stuckSince = now;
            else if (now - stuckSince > 500) { path = null; nudgeUntil = now + 250; nudge = -nudge; stuckSince = 0; }
          } else { stuckSince = 0; }
          lastPos = { x: p.x, y: p.y };
          if (!path || now - plannedAt > 700) {
            // 2-cell clearance first (a 1-cell-clearance path hugs walls the 22 px body cannot pass),
            // 1-cell as the fallback so narrow doorways are still attempted
            var cells = d.findPath(p.x, p.y, t.x, t.y, 40), clearance = 2;
            if (!cells) { cells = d.findPath(p.x, p.y, t.x, t.y, 22); clearance = 1; }
            if (!cells) {
              planFailures++;
              if (planFailures >= 3) return done(reject, { code: 'no_path', message: 'no path to ' + target });
              releaseAll(); return setTimeout(tick, 250);   // transient (wall-hugging start cell): retry
            }
            planFailures = 0;
            path = cells.map(function (c) { return { x: (c.c + 0.5) * NAV_CELL, y: (c.r + 0.5) * NAV_CELL }; });
            path.push({ x: t.x, y: t.y });
            plannedAt = now;
          }
          while (path.length > 1 && Math.hypot(path[0].x - p.x, path[0].y - p.y) < CAPTURE) path.shift();
          var wp = path[0], dx = wp.x - p.x, dy = wp.y - p.y;
          // debug window (not part of the contract): lets a harness author watch the walk
          window.__mousieDebug = { target: target, p: { x: Math.round(p.x), y: Math.round(p.y) }, t: { x: Math.round(t.x), y: Math.round(t.y) },
                                   wp: { x: Math.round(wp.x), y: Math.round(wp.y) }, left: path.length, clearance: clearance, stuck: !!stuckSince, nudging: now < nudgeUntil };
          var horizontal = Math.abs(dx) > Math.abs(dy);
          if (now < nudgeUntil) {
            // stuck: re-centre inside the current cell on the perpendicular axis (a body straddling
            // a wall edge is the usual cause), alternating sides if the centre itself is blocked
            var cx = (Math.floor(p.x / NAV_CELL) + 0.5) * NAV_CELL, cy = (Math.floor(p.y / NAV_CELL) + 0.5) * NAV_CELL;
            if (horizontal) { dx = 0; dy = Math.abs(cy - p.y) > 2 ? cy - p.y : nudge * 40; }
            else { dy = 0; dx = Math.abs(cx - p.x) > 2 ? cx - p.x : nudge * 40; }
          } else if (horizontal) { dy = 0; if (Math.abs(dx) <= TOL) dx = 0; } else { dx = 0; if (Math.abs(dy) <= TOL) dy = 0; }
          key('KeyD', dx > 0); key('KeyA', dx < 0); key('KeyS', dy > 0); key('KeyW', dy < 0);
          setTimeout(tick, TICK_MS);
        })();
      });
    },

    setup: function (opts) {
      var applied = [];
      if (opts.progress != null && progressApplied) applied.push('progress');
      // runtime flags are honoured on every dungeon of the run (applied per scene instance)
      if (opts.no_enemies) applied.push('no_enemies');
      if (opts.invulnerable) applied.push('invulnerable');
      applyDungeonSetup(dungeon());
      return applied;
    }
  });

  // ---- events: forward every EventBus emit as-is (audio:keyGrab, audio:takeDamage, ...) ----
  if (!isMenuPage()) {
    import('/js/audio/EventBus.js').then(function (m) {
      var bus = m.bus, origEmit = bus.emit.bind(bus);
      bus.emit = function (name, data) { GR.emit(name, data); return origEmit(name, data); };
    }).catch(function (e) { console.error('[guardrail adapter] EventBus not available: ' + e.message); });
  }
})();
