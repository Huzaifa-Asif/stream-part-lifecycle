import { createPartLifecycleTracker, fromAiSdkChunk } from 'stream-part-lifecycle';

const chunks = [
  { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', delta: 'Hello' },
  { type: 'text-end', id: 'answer' },
];
const tracker = createPartLifecycleTracker();
for (const chunk of chunks) {
  const event = fromAiSdkChunk(chunk);
  if (event) tracker.observe(event);
}
const report = tracker.finalize();
console.log(JSON.stringify(report, null, 2));
if (!report.valid) process.exitCode = 1;
