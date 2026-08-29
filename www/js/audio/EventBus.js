// ============================================
// EventBus — tiny pub/sub for decoupled audio + UI events
// Single global instance, used by AudioManager + gameplay code.
// ============================================

class EventBus {
    constructor() {
        this._handlers = new Map();
    }

    on(event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(fn);
        return () => this.off(event, fn);
    }

    off(event, fn) {
        const set = this._handlers.get(event);
        if (set) set.delete(fn);
    }

    emit(event, data) {
        const set = this._handlers.get(event);
        if (!set) return;
        for (const fn of set) {
            try { fn(data); } catch (e) { console.warn('[EventBus] handler error', event, e); }
        }
    }

    clear(event) {
        if (event) this._handlers.delete(event);
        else this._handlers.clear();
    }
}

export const bus = new EventBus();
