import type { AnswerSource, RunEvent, RunEventType, WorkflowRun } from '@gard/contracts';

export class AgentExecutionError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export type RunInput = {
  runId: string;
  conversationId: string;
  input: string;
  history: { role: 'user' | 'assistant'; content: string }[];
};
export type ClaimedRun = RunInput & { leaseToken: string; attempt: number };
export type AgentEvent = { type: RunEventType; message: string | null; taskId: string | null };
export type AgentAnswer = { answer: string; sources: AnswerSource[] };
export interface AgentEngine {
  execute(
    input: RunInput,
    options: { signal: AbortSignal; emit(event: AgentEvent): Promise<void> },
  ): Promise<AgentAnswer>;
  close(): Promise<void>;
}
export interface WorkflowRepository {
  detail(digest: string, id: string, now: Date): Promise<WorkflowRun>;
  list(digest: string, conversationId: string, now: Date): Promise<WorkflowRun[]>;
  events(
    digest: string,
    id: string,
    after: number,
    now: Date,
  ): Promise<{ data: RunEvent[]; run: WorkflowRun }>;
  cancel(digest: string, id: string, now: Date): Promise<WorkflowRun>;
  claim(now: Date, leaseSeconds: number): Promise<ClaimedRun | null>;
  heartbeat(id: string, token: string, now: Date, leaseSeconds: number): Promise<boolean>;
  append(id: string, token: string, event: AgentEvent, now: Date): Promise<boolean>;
  complete(id: string, token: string, answer: AgentAnswer, now: Date): Promise<boolean>;
  fail(id: string, token: string, code: string, message: string, now: Date): Promise<boolean>;
  close(): Promise<void>;
}
