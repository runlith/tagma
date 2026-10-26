import { Usage } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import type { AgentStep } from '../../agent/AgentStep';
import {
  threadGuidanceEvent,
  threadStepFinishedEvent,
  threadStepMessagesEvent,
  type ThreadEventBody,
  type ThreadStepContext,
} from '../events';
import type { ThreadRunRow } from '../rows';
import type { RunRequest } from './requests';
import { threadRunUsage } from './ThreadRunCycle';

export type ThreadStepBatch = {
  readonly events: readonly ThreadEventBody[];
  readonly stepMessages: readonly Message[];
  readonly requests: readonly RunRequest[];
};

export class ThreadStepRecords {
  private readonly measuredAt = new Map<number, string>();
  private readonly windows = new Map<number, number | null>();
  private readonly earlyInput = new Map<number, number>();
  private readonly attempts = new Map<number, number>();
  private readonly answered = new Map<number, RunRequest>();
  private readonly requested = new Set<number>();
  private lastProjected: number | null = null;
  private readonly committed = new Set<number>();
  private appended = 0;

  constructor(
    private readonly run: ThreadRunRow,
    private readonly stepsTaken: number,
    private readonly contextWindow: () => number | null,
    private readonly inputLimit: () => number | null,
  ) {}

  finished(index: number, usage: Usage | undefined): void {
    if (usage === undefined || this.requested.has(index) || this.answered.has(index)) return;
    this.measuredAt.set(index, new Date().toISOString());
    this.answered.set(index, { stepNumber: index, attempt: this.attempts.get(index) ?? 0, usage: this.measuredOf(index, usage) ?? null });
  }

  retried(stepNumber: number, attempt: number): void {
    this.attempts.set(stepNumber, attempt);
  }

  promptCounted(inputTokens: number): void {
    if (this.lastProjected !== null) this.earlyInput.set(this.lastProjected, inputTokens);
  }

  estimated(stepNumber: number, contextWindow: number | null): void {
    this.windows.set(stepNumber, contextWindow);
    this.lastProjected = stepNumber;
  }

  intentCommitted(stepNumber: number): void {
    this.committed.add(stepNumber);
  }

  contextOf(stepNumber: number, activity?: string): ThreadStepContext {
    return {
      runId: this.run.id,
      stepNumber,
      activity: activity,
      provider: this.run.provider,
      model: this.run.model,
      contextWindow: this.windows.get(stepNumber) ?? this.contextWindow(),
      inputLimit: this.inputLimit(),
      measuredAt: this.measuredAt.get(stepNumber) ?? new Date().toISOString(),
    };
  }

  startsAt(): number {
    return this.stepsTaken + this.appended;
  }

  pending(steps: readonly AgentStep[]): readonly AgentStep[] {
    return steps.slice(this.appended);
  }

  landed(requests: readonly RunRequest[]): void {
    for (const request of requests) {
      this.requested.add(request.stepNumber);
      this.answered.delete(request.stepNumber);
    }
  }

  appendedSteps(count: number): void {
    for (let offset = 0; offset < count; offset += 1) {
      const stepNumber = this.stepsTaken + this.appended + offset;
      this.measuredAt.delete(stepNumber);
      this.windows.delete(stepNumber);
      this.earlyInput.delete(stepNumber);
      this.attempts.delete(stepNumber);
      this.answered.delete(stepNumber);
      this.requested.delete(stepNumber);
      this.committed.delete(stepNumber);
    }
    this.appended += count;
  }

  events(newSteps: readonly AgentStep[], guidance: readonly AgentRuntimeGuidance[]): ThreadStepBatch {
    const events: ThreadEventBody[] = [];
    const stepMessages: Message[] = [];
    const requests: RunRequest[] = [...this.answered.values()];
    let guidanceIndex = 0;
    for (let offset = 0; offset < newSteps.length; offset += 1) {
      const stepNumber = this.stepsTaken + this.appended + offset;
      while (guidanceIndex < guidance.length) {
        const frame = guidance[guidanceIndex];
        if (!frame || frame.stepNumber === undefined || frame.stepNumber > stepNumber) break;
        events.push(threadGuidanceEvent(frame));
        guidanceIndex += 1;
      }
      const step = newSteps[offset];
      const replay = step?.response?.messages ?? [];
      const measured = this.measuredOf(stepNumber, step?.usage);
      const context = this.contextOf(stepNumber, step?.activity);
      const event = threadStepMessagesEvent(this.committed.has(stepNumber) ? replay.filter((message) => message.role === 'tool') : replay, {
        context,
        usage: measured,
      });
      if (event) {
        events.push(event);
        stepMessages.push(...(event.payload.messages ?? []));
      }
      events.push(threadStepFinishedEvent(context, measured));
      if (!this.requested.has(stepNumber) && !this.answered.has(stepNumber))
        requests.push({ stepNumber, attempt: this.attempts.get(stepNumber) ?? 0, usage: measured ?? null });
    }
    for (; guidanceIndex < guidance.length; guidanceIndex += 1) {
      const frame = guidance[guidanceIndex];
      if (frame) events.push(threadGuidanceEvent(frame));
    }
    return { events, stepMessages, requests };
  }

  private measuredOf(stepNumber: number, usage: Usage | undefined): Usage | undefined {
    if (usage !== undefined) return threadRunUsage(usage) ?? undefined;
    const early = this.earlyInput.get(stepNumber);
    return early === undefined ? undefined : (threadRunUsage(new Usage({ inputTokens: early, totalTokens: early })) ?? undefined);
  }
}
