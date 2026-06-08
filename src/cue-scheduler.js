const { CUE_STATES, AGENT_STATES, TICK_MS } = require('./constants');

class CueScheduler {
  constructor() {
    this._cues = new Map();      // cue_id → cue record
    this._pending = [];          // cues with remaining beats > 0, sorted by fire time
    this._seq = 0;
    this._completedLog = [];     // last 100 completed cues for audit
  }

  /**
   * Schedule a t-minus cue.
   * @param {Object} spec
   * @param {string} spec.sourceId - Agent issuing the cue
   * @param {string} spec.targetId - Agent receiving the cue
   * @param {number} spec.offsetBeats - T-minus offset (positive=countdown, zero=now, negative=pre-cue)
   * @param {string} spec.phaseGroup - Phase group this cue belongs to
   * @param {object} [spec.payload] - Optional context payload
   * @returns {Object} { cueId, isPreCue, delayMs }
   */
  schedule(spec) {
    const cueId = `cue_${Date.now().toString(36)}_${(++this._seq).toString(36)}`;
    const now = Date.now();
    const delayMs = Math.max(0, spec.offsetBeats * TICK_MS);

    const cue = {
      id: cueId,
      source_id: spec.sourceId,
      target_id: spec.targetId,
      phase_group: spec.phaseGroup,
      offset_beats: spec.offsetBeats,
      delay_ms: delayMs,
      issued_at: now,
      scheduled_fire_at: now + delayMs,
      state: CUE_STATES.SCHEDULED,
      payload: spec.payload || null,
    };

    this._cues.set(cueId, cue);

    if (spec.offsetBeats <= 0) {
      // Pre-cue or immediate: mark as delivered immediately
      cue.state = CUE_STATES.DELIVERED;
      return { cueId, isPreCue: true, delayMs: 0 };
    }

    // Insert into pending list sorted by fire time
    this._pending.push(cue);
    this._pending.sort((a, b) => a.scheduled_fire_at - b.scheduled_fire_at);

    return { cueId, isPreCue: false, delayMs };
  }

  /**
   * Tick the scheduler — return all cues whose countdown has completed.
   * @param {number} now - Current timestamp
   * @returns {Array} cues ready to fire
   */
  tick(now) {
    const ready = [];
    while (this._pending.length > 0 && this._pending[0].scheduled_fire_at <= now) {
      const cue = this._pending.shift();
      if (cue.state === CUE_STATES.SCHEDULED) {
        cue.state = CUE_STATES.DELIVERED;
        ready.push(cue);
      }
    }
    return ready;
  }

  /**
   * Mark a cue as completed (agent reported).
   * @param {string} cueId
   * @returns {boolean} success
   */
  complete(cueId) {
    const cue = this._cues.get(cueId);
    if (!cue) return false;
    if (cue.state !== CUE_STATES.DELIVERED) return false;
    cue.state = CUE_STATES.COMPLETED;
    this._completedLog.push(cue);
    if (this._completedLog.length > 100) this._completedLog.shift();
    return true;
  }

  /**
   * Cancel a pending cue.
   */
  cancel(cueId) {
    const cue = this._cues.get(cueId);
    if (!cue) return false;
    this._pending = this._pending.filter(c => c.id !== cueId);
    cue.state = CUE_STATES.CANCELLED;
    return true;
  }

  getCue(cueId) {
    return this._cues.get(cueId) || null;
  }

  getPending(phaseGroup) {
    return this._pending.filter(c => c.phase_group === phaseGroup);
  }

  getActive() {
    return Array.from(this._cues.values()).filter(c =>
      c.state === CUE_STATES.SCHEDULED || c.state === CUE_STATES.DELIVERED
    );
  }

  getCompleted(limit = 20) {
    return this._completedLog.slice(-limit);
  }

  count() {
    return this._cues.size;
  }

  activeCount() {
    return this._cues.size - this._completedLog.length;
  }
}

module.exports = { CueScheduler };
