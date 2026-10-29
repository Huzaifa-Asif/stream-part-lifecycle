export type PartEventType = 'start' | 'delta' | 'end';

export interface PartEvent { type: PartEventType; id: string; kind: string }
export interface PartIssue {
  readonly code: string;
  readonly eventIndex: number;
  readonly id: string | null;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly limit?: number;
}
export interface PartSnapshot {
  readonly events: number;
  readonly acceptedEvents: number;
  readonly issueCount: number;
  readonly retainedIssueCount: number;
  readonly droppedIssues: number;
  readonly openParts: readonly Readonly<{ id: string; kind: string; startedAt: number; deltas: number }>[];
  readonly rememberedClosedParts: number;
  readonly evictedClosedParts: number;
  readonly finalized: boolean;
}
export interface ObserveResult {
  readonly accepted: boolean;
  readonly issues: readonly PartIssue[];
  readonly snapshot: PartSnapshot;
}
export interface FinalResult {
  readonly valid: boolean;
  readonly issues: readonly PartIssue[];
  readonly snapshot: PartSnapshot;
}
export interface PartLifecycleTracker {
  observe(event: PartEvent): ObserveResult;
  finalize(): FinalResult;
  snapshot(): PartSnapshot;
}
export interface TrackerOptions {
  maxOpenParts?: number;
  maxClosedParts?: number;
  maxDiagnosticIssues?: number;
  maxIdentifierLength?: number;
}
export function createPartLifecycleTracker(options?: TrackerOptions): PartLifecycleTracker;
export function fromAiSdkChunk(chunk: unknown): Readonly<PartEvent> | null;

declare const api: {
  createPartLifecycleTracker: typeof createPartLifecycleTracker;
  fromAiSdkChunk: typeof fromAiSdkChunk;
};
export default api;
