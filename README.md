# stream-part-lifecycle

Audit keyed `start → delta* → end` stream parts before malformed or interleaved events corrupt UI state. The package is provider-neutral, deterministic, bounded, zero-dependency, and works through ESM, CommonJS, and TypeScript.

## Why

Streaming UIs usually keep active text or reasoning parts in a map keyed by an ID. A delta before its start, a changed kind, a reused ID, or a missing end can otherwise become an opaque crash or silently merge parallel output. This package validates the normalized boundary; it does not own transport, rendering, retry, persistence, or provider calls.

## Install

```sh
npm install stream-part-lifecycle
```

Node.js 20 or newer is supported. Browser bundlers with CommonJS interop can consume the ESM wrapper; direct native-browser loading is not advertised in 1.0.0.

## Quick start

```js
import { createPartLifecycleTracker, fromAiSdkChunk } from 'stream-part-lifecycle';

const tracker = createPartLifecycleTracker({ maxOpenParts: 64, maxClosedParts: 256 });
for await (const chunk of uiMessageChunks) {
  const event = fromAiSdkChunk(chunk);
  if (event) {
    const observation = tracker.observe(event);
    if (!observation.accepted) console.error(observation.issues);
  }
}
const report = tracker.finalize();
```

CommonJS:

```js
const { createPartLifecycleTracker } = require('stream-part-lifecycle');
```

Run the shipped example with `node node_modules/stream-part-lifecycle/examples/audit-stream.mjs`.

## API

### `createPartLifecycleTracker(options?)`

- `maxOpenParts` (default `256`) rejects new starts once the open-part bound is reached.
- `maxClosedParts` (default `1024`) bounds ended-ID memory. After eviction, very late events for that ID can only be reported as missing-start events.
- `maxDiagnosticIssues` (default `1024`) bounds retained issues; total and dropped counts remain available.
- `maxIdentifierLength` (default `256`) rejects oversized IDs and kinds and bounds diagnostic strings.
- `observe({ type, id, kind })` accepts normalized `start`, `delta`, or `end` events and returns immutable evidence.
- `snapshot()` returns bounded counters and open parts.
- `finalize()` reports every still-open part and seals the tracker. It is idempotent.

Issue codes include `delta-before-start`, `end-before-start`, `duplicate-start`, `reopened-id`, `event-after-end`, `kind-mismatch`, `open-limit-exceeded`, `unclosed-part`, and input-validation codes.

### `fromAiSdkChunk(chunk)`

Adapts AI SDK `text-*` and `reasoning-*` chunks to normalized events. It returns `null` for unrelated chunks. The adapter intentionally does not claim to validate a complete AI SDK protocol.

## Runtime and operational notes

- Feed events in observed order; the tracker does not reorder them.
- Use stable unique IDs per part. Reopening a remembered ended ID is an error.
- A rejected event never mutates part state.
- Evidence objects are frozen, and malformed diagnostic values are reduced to bounded primitive descriptions; input objects are not retained.
- No content or deltas are stored, which limits accidental sensitive-data retention.

## Alternatives

- Prefer your SDK's native parser when it already validates lifecycle order and emits actionable errors.
- Use a JSON Schema validator for event shape validation; this package checks cross-event state, not arbitrary schemas.
- Use `ai-stream-auditor` for whole-stream terminal/abort lifecycle evidence; it does not track keyed text or reasoning parts.
- Use Node/Web streams libraries for transport and backpressure; they do not validate application-level keyed part IDs.

## Troubleshooting

- `delta-before-start`: replay or emit the matching start before the delta.
- `kind-mismatch`: keep the same kind for an ID or allocate a new ID.
- `event-after-end`: stop forwarding late events or allocate a new ID.
- `unclosed-part`: close every started part on success, error, and abort paths.
- `open-limit-exceeded`: investigate leaked/unclosed parts before increasing the bound.

## Security

This package performs local validation only. It does not sanitize displayed content, authenticate events, or make untrusted HTML safe. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
