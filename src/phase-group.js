const { AGENT_STATES } = require('./constants');

class PhaseGroupManager {
  constructor() {
    this._groups = new Map();    // group_name → { name, agents[], sequence, state, alignmentPoints[] }
  }

  /**
   * Ensure a phase group exists. Creates it if needed.
   */
  ensureGroup(name) {
    if (!this._groups.has(name)) {
      this._groups.set(name, {
        name,
        agents: [],
        sequence: 0,
        state: 'idle',
        alignment_points: [],
        created_at: Date.now(),
        last_alignment: null,
      });
    }
    return this._groups.get(name);
  }

  /**
   * Add an agent to a phase group.
   */
  addAgent(groupName, agentId) {
    const group = this.ensureGroup(groupName);
    if (!group.agents.includes(agentId)) {
      group.agents.push(agentId);
    }
    return true;
  }

  /**
   * Remove an agent from a phase group.
   */
  removeAgent(groupName, agentId) {
    const group = this._groups.get(groupName);
    if (!group) return false;
    group.agents = group.agents.filter(id => id !== agentId);
    if (group.agents.length === 0) {
      this._groups.delete(groupName);
    }
    return true;
  }

  /**
   * Open a new alignment point in the group.
   * @returns {Object} the new alignment point
   */
  openAlignmentPoint(groupName) {
    const group = this.ensureGroup(groupName);
    group.sequence++;
    group.state = 'active';
    const point = {
      id: `P_${String(group.sequence).padStart(3, '0')}`,
      phase_group: groupName,
      sequence: group.sequence,
      opened_at: Date.now(),
      cues_issued: 0,
      cues_completed: 0,
      agent_count: group.agents.length,
      state: 'awaiting_completion',
    };
    group.alignment_points.push(point);
    if (group.alignment_points.length > 50) group.alignment_points.shift();
    group.last_alignment = point;
    return point;
  }

  /**
   * Record that a cue was issued for an alignment point.
   */
  recordCueIssued(groupName) {
    const group = this.ensureGroup(groupName);
    const point = group.last_alignment;
    if (point) point.cues_issued++;
    return point;
  }

  /**
   * Record that a cue was completed for an alignment point.
   * Returns the alignment point if all agents in group have completed.
   */
  recordCueCompleted(groupName) {
    const group = this.ensureGroup(groupName);
    const point = group.last_alignment;
    if (!point) return null;
    point.cues_completed++;
    if (point.cues_completed >= point.agent_count && point.agent_count > 0) {
      group.state = 'completed';
      return point;
    }
    return null;
  }

  /**
   * Check if an agent belongs to a group.
   */
  hasAgent(groupName, agentId) {
    const group = this._groups.get(groupName);
    return group ? group.agents.includes(agentId) : false;
  }

  /**
   * Get all groups.
   */
  getAll() {
    return Array.from(this._groups.values());
  }

  getGroup(name) {
    return this._groups.get(name) || null;
  }

  removeAgentFromAll(agentId) {
    const groups = [];
    for (const [name, group] of this._groups) {
      if (group.agents.includes(agentId)) {
        group.agents = group.agents.filter(id => id !== agentId);
        groups.push(name);
      }
    }
    return groups;
  }
}

module.exports = { PhaseGroupManager };
