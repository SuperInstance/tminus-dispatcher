const { TICK_MS } = require('./constants');

class BeatEngine {
  constructor() {
    this._counter = 0;
    this._interval = null;
    this._listeners = [];
    this._startedAt = null;
    this._ticksPerSecond = 0;
    this._lastTickTime = null;
  }

  /**
   * Start the beat engine ticking.
   * @param {number} [intervalMs=TICK_MS] - Milliseconds per cognitive beat
   */
  start(intervalMs = TICK_MS) {
    if (this._interval) return;
    this._startedAt = Date.now();
    this._lastTickTime = this._startedAt;
    this._counter = 0;

    this._interval = setInterval(() => {
      this._counter++;
      const now = Date.now();
      this._ticksPerSecond = 1000 / (now - this._lastTickTime + 1);
      this._lastTickTime = now;
      this._notify(now);
    }, intervalMs);

    return this;
  }

  /**
   * Stop the beat engine.
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    return this;
  }

  /**
   * Register a listener for beat ticks.
   * @param {Function} fn - Function(timestamp_ms)
   * @returns {Function} unsubscribe function
   */
  onTick(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter(l => l !== fn);
    };
  }

  _notify(now) {
    for (const fn of this._listeners) {
      try {
        fn(now);
      } catch (err) {
        console.error('[BeatEngine] Listener error:', err.message);
      }
    }
  }

  /**
   * Get engine stats.
   */
  getStats() {
    return {
      counter: this._counter,
      started_at: this._startedAt,
      uptime_ms: this._startedAt ? Date.now() - this._startedAt : 0,
      ticks_per_second: this._ticksPerSecond,
      is_running: this._interval !== null,
      tick_ms: TICK_MS,
    };
  }

  /**
   * Convert cognitive beats to milliseconds.
   */
  beatsToMs(beats) {
    return beats * TICK_MS;
  }

  /**
   * Convert milliseconds to cognitive beats (rounded down).
   */
  msToBeats(ms) {
    return Math.floor(ms / TICK_MS);
  }
}

module.exports = { BeatEngine };
