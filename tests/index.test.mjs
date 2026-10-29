import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import esm, { createPartLifecycleTracker, fromAiSdkChunk } from '../src/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../src/index.cjs');

test('ESM and CommonJS expose the same named API', () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
});

test('accepts independent interleaved parts', () => {
  const tracker = createPartLifecycleTracker();
  for (const event of [
    { type: 'start', id: 'a', kind: 'text' },
    { type: 'start', id: 'b', kind: 'text' },
    { type: 'delta', id: 'a', kind: 'text' },
    { type: 'delta', id: 'b', kind: 'text' },
    { type: 'end', id: 'a', kind: 'text' },
    { type: 'end', id: 'b', kind: 'text' },
  ]) assert.equal(tracker.observe(event).accepted, true);
  assert.equal(tracker.finalize().valid, true);
});

test('reports missing starts, duplicate starts, kind drift, and events after end', () => {
  const tracker = createPartLifecycleTracker();
  assert.equal(tracker.observe({ type: 'delta', id: 'x', kind: 'text' }).issues[0].code, 'delta-before-start');
  tracker.observe({ type: 'start', id: 'x', kind: 'text' });
  assert.equal(tracker.observe({ type: 'start', id: 'x', kind: 'text' }).issues[0].code, 'duplicate-start');
  assert.equal(tracker.observe({ type: 'delta', id: 'x', kind: 'reasoning' }).issues[0].code, 'kind-mismatch');
  tracker.observe({ type: 'end', id: 'x', kind: 'text' });
  assert.equal(tracker.observe({ type: 'delta', id: 'x', kind: 'text' }).issues[0].code, 'event-after-end');
  assert.equal(tracker.observe({ type: 'start', id: 'x', kind: 'text' }).issues[0].code, 'reopened-id');
});

test('finalize reports open parts and is idempotent', () => {
  const tracker = createPartLifecycleTracker();
  tracker.observe({ type: 'start', id: 'open', kind: 'text' });
  const first = tracker.finalize();
  const second = tracker.finalize();
  assert.equal(first.issues[0].code, 'unclosed-part');
  assert.deepEqual(first, second);
  assert.throws(() => tracker.observe({ type: 'end', id: 'open', kind: 'text' }), /finalized/);
});

test('bounds open and remembered closed state', () => {
  const tracker = createPartLifecycleTracker({ maxOpenParts: 1, maxClosedParts: 1 });
  tracker.observe({ type: 'start', id: 'a', kind: 'text' });
  assert.equal(tracker.observe({ type: 'start', id: 'b', kind: 'text' }).issues[0].code, 'open-limit-exceeded');
  tracker.observe({ type: 'end', id: 'a', kind: 'text' });
  tracker.observe({ type: 'start', id: 'b', kind: 'text' });
  tracker.observe({ type: 'end', id: 'b', kind: 'text' });
  assert.equal(tracker.snapshot().evictedClosedParts, 1);
});

test('rejects malformed options and events without throwing from observe', () => {
  assert.throws(() => createPartLifecycleTracker(null), /options/);
  assert.throws(() => createPartLifecycleTracker({ maxOpenParts: 0 }), /positive safe integer/);
  const tracker = createPartLifecycleTracker();
  assert.equal(tracker.observe(null).issues[0].code, 'invalid-event');
  assert.equal(tracker.observe({ type: 'wat', id: '', kind: '' }).issues.length, 3);
});

test('bounds diagnostic retention and identifier sizes', () => {
  const tracker = createPartLifecycleTracker({ maxDiagnosticIssues: 2, maxIdentifierLength: 8 });
  for (let index = 0; index < 10; index += 1) tracker.observe({ type: 'delta', id: `missing${index}`, kind: 'text' });
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.issueCount, 10);
  assert.equal(snapshot.retainedIssueCount, 2);
  assert.equal(snapshot.droppedIssues, 8);
  assert.equal(tracker.observe({ type: 'start', id: '123456789', kind: 'text' }).issues[0].code, 'id-too-long');
  assert.equal(tracker.observe({ type: 'start', id: 'ok', kind: '123456789' }).issues[0].code, 'kind-too-long');
});

test('sanitizes hostile diagnostic values into immutable primitives', () => {
  const mutableId = { value: 'secret' };
  const tracker = createPartLifecycleTracker();
  const result = tracker.observe({ type: 'wat', id: mutableId, kind: {} });
  mutableId.value = 'changed';
  assert.equal(result.issues[0].id, '<object>');
  assert.equal(typeof result.issues[0].actual, 'string');
  assert.equal(Object.isFrozen(result.issues[0]), true);
  const unreadable = new Proxy({}, { get() { throw new Error('hostile getter'); } });
  assert.equal(tracker.observe(unreadable).issues[0].code, 'invalid-event');
});

test('adapts supported AI SDK text and reasoning chunks only', () => {
  assert.deepEqual(fromAiSdkChunk({ type: 'text-delta', id: 't', delta: 'x' }), { type: 'delta', kind: 'text', id: 't' });
  assert.deepEqual(fromAiSdkChunk({ type: 'reasoning-end', id: 'r' }), { type: 'end', kind: 'reasoning', id: 'r' });
  assert.equal(fromAiSdkChunk({ type: 'finish' }), null);
  assert.equal(fromAiSdkChunk({ type: 'text-start' }), null);
  assert.equal(fromAiSdkChunk({ type: 'reasoning-delta', id: 0 }), null);
  assert.equal(fromAiSdkChunk(null), null);
  const hostile = new Proxy({}, { get() { throw new Error('hostile getter'); } });
  assert.equal(fromAiSdkChunk(hostile), null);
  let reads = 0;
  const stateful = { type: 'text-start', get id() { reads += 1; return reads === 1 ? 'stable' : { bad: true }; } };
  assert.deepEqual(fromAiSdkChunk(stateful), { type: 'start', kind: 'text', id: 'stable' });
  assert.equal(reads, 1);
});

test('returned evidence is immutable', () => {
  const tracker = createPartLifecycleTracker();
  const result = tracker.observe({ type: 'start', id: 'a', kind: 'text' });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.snapshot.openParts), true);
  assert.throws(() => result.snapshot.openParts.push({}));
});
