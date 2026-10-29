'use strict';

const EVENT_TYPES = new Set(['start', 'delta', 'end']);

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function freezeIssue(code, index, id, message, detail = {}) {
  return Object.freeze({ code, eventIndex: index, id, message, ...detail });
}

function clonePart(part) {
  return Object.freeze({ id: part.id, kind: part.kind, startedAt: part.startedAt, deltas: part.deltas });
}

function createPartLifecycleTracker(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const maxOpenParts = positiveInteger(options.maxOpenParts, 'maxOpenParts', 256);
  const maxClosedParts = positiveInteger(options.maxClosedParts, 'maxClosedParts', 1024);
  const maxDiagnosticIssues = positiveInteger(options.maxDiagnosticIssues, 'maxDiagnosticIssues', 1024);
  const maxIdentifierLength = positiveInteger(options.maxIdentifierLength, 'maxIdentifierLength', 256);
  const open = new Map();
  const closed = new Map();
  const closedOrder = [];
  const issues = [];
  let eventIndex = 0;
  let acceptedEvents = 0;
  let evictedClosedParts = 0;
  let issueCount = 0;
  let droppedIssues = 0;
  let finalized = false;

  function diagnostic(value) {
    if (typeof value === 'string') {
      return value.length <= maxIdentifierLength ? value : `${value.slice(0, maxIdentifierLength - 1)}…`;
    }
    if (value === null || value === undefined) return null;
    return `<${typeof value}>`;
  }

  function add(code, id, message, detail) {
    issueCount += 1;
    const issue = freezeIssue(code, eventIndex, diagnostic(id), message, detail);
    if (issues.length < maxDiagnosticIssues) issues.push(issue);
    else droppedIssues += 1;
    return issue;
  }

  function snapshot() {
    return Object.freeze({
      events: eventIndex,
      acceptedEvents,
      issueCount,
      retainedIssueCount: issues.length,
      droppedIssues,
      openParts: Object.freeze([...open.values()].map(clonePart)),
      rememberedClosedParts: closed.size,
      evictedClosedParts,
      finalized,
    });
  }

  function observe(event) {
    if (finalized) throw new Error('tracker is finalized');
    eventIndex += 1;
    const before = issueCount;
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      const issue = add('invalid-event', null, 'Event must be an object.');
      return Object.freeze({ accepted: false, issues: Object.freeze([issue]), snapshot: snapshot() });
    }
    let type;
    let id;
    let kind;
    try {
      ({ type, id, kind } = event);
    } catch {
      const issue = add('invalid-event', null, 'Event fields could not be read safely.');
      return Object.freeze({ accepted: false, issues: Object.freeze([issue]), snapshot: snapshot() });
    }
    const observed = [];
    function reject(code, message, detail) {
      const issue = add(code, id, message, detail);
      observed.push(issue);
    }
    if (!EVENT_TYPES.has(type)) {
      reject('invalid-type', 'Event type must be start, delta, or end.', { actual: diagnostic(type) });
    }
    if (typeof id !== 'string' || id.trim() === '') {
      reject('invalid-id', 'Event id must be a non-empty string.');
    }
    if (typeof id === 'string' && id.length > maxIdentifierLength) {
      reject('id-too-long', 'Event id exceeds maxIdentifierLength.', { limit: maxIdentifierLength });
    }
    if (typeof kind !== 'string' || kind.trim() === '') {
      reject('invalid-kind', 'Event kind must be a non-empty string.');
    }
    if (typeof kind === 'string' && kind.length > maxIdentifierLength) {
      reject('kind-too-long', 'Event kind exceeds maxIdentifierLength.', { limit: maxIdentifierLength });
    }
    if (issueCount !== before) {
      return Object.freeze({ accepted: false, issues: Object.freeze(observed), snapshot: snapshot() });
    }

    const label = diagnostic(id);
    const active = open.get(id);
    const ended = closed.get(id);

    if (type === 'start') {
      if (active) observed.push(add('duplicate-start', id, `Part "${label}" is already open.`, { expected: active.kind, actual: kind }));
      else if (ended) observed.push(add('reopened-id', id, `Part "${label}" already ended. Use a new id.`, { expected: ended.kind, actual: kind }));
      else if (open.size >= maxOpenParts) observed.push(add('open-limit-exceeded', id, `Opening "${label}" would exceed maxOpenParts.`, { limit: maxOpenParts }));
      else {
        open.set(id, { id, kind, startedAt: eventIndex, deltas: 0 });
        acceptedEvents += 1;
      }
    } else if (!active) {
      observed.push(add(ended ? 'event-after-end' : `${type}-before-start`, id,
        ended ? `Part "${label}" already ended.` : `Part "${label}" has no matching start.`,
        ended ? { expected: ended.kind, actual: kind } : undefined));
    } else if (active.kind !== kind) {
      observed.push(add('kind-mismatch', id, `Part "${label}" changed kind.`, { expected: active.kind, actual: kind }));
    } else if (type === 'delta') {
      active.deltas += 1;
      acceptedEvents += 1;
    } else {
      open.delete(id);
      const record = { id, kind, endedAt: eventIndex };
      closed.set(id, record);
      closedOrder.push(id);
      acceptedEvents += 1;
      while (closedOrder.length > maxClosedParts) {
        closed.delete(closedOrder.shift());
        evictedClosedParts += 1;
      }
    }
    return Object.freeze({ accepted: issueCount === before, issues: Object.freeze(observed), snapshot: snapshot() });
  }

  function finalize() {
    if (!finalized) {
      for (const part of open.values()) {
        add('unclosed-part', part.id, `Part "${diagnostic(part.id)}" did not end.`, { expected: part.kind });
      }
      finalized = true;
    }
    return Object.freeze({ valid: issueCount === 0, issues: Object.freeze([...issues]), snapshot: snapshot() });
  }

  return Object.freeze({ observe, finalize, snapshot });
}

function fromAiSdkChunk(chunk) {
  if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return null;
  let type;
  let id;
  try {
    type = chunk.type;
    id = chunk.id;
  } catch {
    return null;
  }
  const match = /^(text|reasoning)-(start|delta|end)$/.exec(type);
  if (!match || typeof id !== 'string' || id.trim() === '') return null;
  return Object.freeze({ type: match[2], kind: match[1], id });
}

module.exports = { createPartLifecycleTracker, fromAiSdkChunk };
