'use strict';

const STAGES = [
  { id: 'fetch_ticket', label: 'Fetching Jira ticket' },
  { id: 'understand_requirements', label: 'Understanding requirements' },
  { id: 'investigate_jira', label: 'Investigating related issues' },
  { id: 'explore_codebase', label: 'Exploring codebase' },
  { id: 'draft_plan', label: 'Analyzing impact, building checklist & QA scenarios' },
  { id: 'validate_plan', label: 'Validating plan & evidence' },
  { id: 'save_plan', label: 'Saving development plan' },
];

const MAX_EVENTS = 80;

/**
 * Tracks real agent stages (no synthetic percentages). Stages move
 * pending → active → done | skipped | failed, with a timestamped activity log.
 */
class ProgressTracker {
  constructor(onChange, initial) {
    this.onChange = onChange || (() => {});
    this.state = initial?.stages
      ? initial
      : { stages: STAGES.map((s) => ({ ...s, status: 'pending', startedAt: null, finishedAt: null, note: null })), events: [], current: null };
  }

  stage(id) {
    return this.state.stages.find((s) => s.id === id);
  }

  emit() {
    return this.onChange(JSON.parse(JSON.stringify(this.state)));
  }

  start(id, note) {
    const s = this.stage(id);
    if (!s || s.status === 'done') return this.emit();
    if (s.status !== 'active') {
      s.status = 'active';
      s.startedAt = new Date().toISOString();
    }
    if (note) s.note = note;
    this.state.current = id;
    return this.emit();
  }

  complete(id, note) {
    const s = this.stage(id);
    if (!s) return this.emit();
    if (!s.startedAt) s.startedAt = new Date().toISOString();
    s.status = 'done';
    s.finishedAt = new Date().toISOString();
    if (note) s.note = note;
    return this.emit();
  }

  skip(id, note) {
    const s = this.stage(id);
    if (!s || s.status === 'done') return this.emit();
    if (s.status === 'active') return this.complete(id, note);
    s.status = 'skipped';
    s.note = note || null;
    return this.emit();
  }

  fail(note) {
    const s = this.state.current ? this.stage(this.state.current) : null;
    if (s && s.status === 'active') {
      s.status = 'failed';
      s.finishedAt = new Date().toISOString();
      s.note = note || s.note;
    }
    return this.emit();
  }

  event(message, level = 'info') {
    this.state.events.push({ at: new Date().toISOString(), message: String(message).slice(0, 300), level });
    if (this.state.events.length > MAX_EVENTS) this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    return this.emit();
  }
}

module.exports = { ProgressTracker, STAGES };
