import { Result, type Schema } from 'effect';
import type { AgentStepToolCall } from '../../agent/AgentStep';
import type { CallAdmission } from '../../agent/callProgress';
import type { ToolOutcome } from '../../agent/tool';
import type { WireFailureRecord } from '@runlith/llm/schema/errors';
import type { ToolDisplay } from '../../tool/display';
import { readyAnswersFromToolCall } from '../../tools/ReadyAnswers';
import {
  interruptedInputEntry,
  settleTool,
  toolInputJson,
  type ThreadInterruptedInput,
  type ThreadToolEntry,
  type ThreadToolExecution,
} from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import { toolEntryId } from '../../transcript/entryNames';
import type { ThreadTranscript } from '../../transcript/rows';
import type { ThreadFactQueue, ThreadToolChange } from './ThreadFactQueue';

export type ThreadToolSettling = {
  readonly toolCallId: string;
  readonly toolName: string | null;
  readonly openToolName: string | undefined;
  readonly input?: unknown;
  readonly outcome: ToolOutcome;
};

export type ThreadToolCallOf = {
  readonly id: string;
  readonly runId: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly input: Schema.Json | undefined;
  readonly occurredAt: string;
};

export const settledToolEntry = (
  call: ThreadToolCallOf,
  outcome: ToolOutcome,
  display: ToolDisplay | undefined,
  execution?: ThreadToolExecution,
): ThreadToolEntry => ({
  type: 'tool',
  id: call.id,
  runId: call.runId,
  toolName: call.toolName,
  toolCallId: call.toolCallId,
  toolInput: call.input,
  ...settleTool(outcome),
  toolDisplay: display,
  execution: execution,
  occurredAt: call.occurredAt,
});

export const toolExecutionOf = (admission: CallAdmission): ThreadToolExecution =>
  admission.state === 'queued'
    ? { state: 'queued', reason: admission.reason, after: admission.after }
    : {
        state: 'started',
        at: new Date(admission.at).toISOString(),
        mutates: admission.mutates,
        after: admission.after,
        waitedMs: admission.waitedMs,
      };

export class ThreadToolRecords {
  private readonly calls = new Map<string, { toolName: string; input: Schema.Json | undefined }>();
  private readonly displays = new Map<string, ToolDisplay>();
  private readonly executions = new Map<string, ThreadToolExecution>();
  private readonly openForms = new Set<string>();
  private readonly committed = new Set<string>();
  private readonly interrupted = new Set<string>();
  private readonly known: ReadonlySet<string>;

  constructor(
    private readonly runId: string,
    private readonly queue: ThreadFactQueue,
    runEntries: ThreadTranscript,
  ) {
    this.known = new Set(runEntries.flatMap((entry) => (coreEntry(entry) && entry.type === 'tool' ? [entry.toolCallId] : [])));
  }

  pending(): readonly string[] {
    return [...this.calls.keys()];
  }

  committedStep(): void {
    this.interrupted.clear();
  }

  isKnown(toolCallId: string): boolean {
    return this.known.has(toolCallId);
  }

  displayOf(toolCallId: string): ToolDisplay | undefined {
    return this.displays.get(toolCallId);
  }

  announce(toolCallId: string, toolName: string, input: unknown): void {
    if (this.known.has(toolCallId)) return;
    const toolInput = toolInputJson(input);
    this.calls.set(toolCallId, { toolName, input: toolInput });
    const occurredAt = new Date().toISOString();
    if (!this.committed.has(toolCallId)) {
      const entry: ThreadToolEntry = {
        type: 'tool',
        id: toolEntryId(toolCallId),
        runId: this.runId,
        toolName,
        toolCallId,
        toolState: 'input-available',
        toolInput,
        ...this.shownOf(toolCallId),
        occurredAt,
      };
      this.queue.push({ kind: 'entry', entry });
    }
    const readyAnswers = readyAnswersFromToolCall({ runId: this.runId, toolCallId, toolName, input, occurredAt });
    if (Result.isSuccess(readyAnswers) && readyAnswers.success !== null) this.queue.push({ kind: 'entry', entry: readyAnswers.success });
  }

  display(toolCallId: string, display: ToolDisplay): void {
    this.displays.set(toolCallId, display);
    this.opened(toolCallId, { toolDisplay: display });
  }

  execution(toolCallId: string, admission: CallAdmission): void {
    if (this.executions.get(toolCallId)?.state === 'started') return;
    const execution = toolExecutionOf(admission);
    this.executions.set(toolCallId, execution);
    this.opened(toolCallId, { execution });
  }

  interruptedInput(input: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly received: ThreadInterruptedInput;
    readonly stepNumber?: number;
    readonly attempt?: number;
    readonly cause?: WireFailureRecord;
  }): void {
    const { toolCallId } = input;
    if (this.known.has(toolCallId) || this.interrupted.has(toolCallId)) return;
    this.interrupted.add(toolCallId);
    const display = this.displays.get(toolCallId);
    this.displays.delete(toolCallId);
    this.executions.delete(toolCallId);
    if (this.openForms.delete(toolCallId)) this.queue.dropTool(toolCallId);
    this.queue.push({
      kind: 'entry',
      entry: interruptedInputEntry({
        id: toolEntryId(toolCallId),
        runId: this.runId,
        toolName: input.toolName,
        toolCallId,
        received: input.received,
        interruption:
          input.stepNumber === undefined || input.attempt === undefined
            ? undefined
            : { stepNumber: input.stepNumber, attempt: input.attempt, cause: input.cause },
        display,
        occurredAt: new Date().toISOString(),
      }),
    });
  }

  settle(settling: ThreadToolSettling): void {
    const { toolCallId, outcome } = settling;
    if (this.known.has(toolCallId) || this.interrupted.has(toolCallId)) return;
    const call = this.calls.get(toolCallId);
    const name = settling.toolName ?? call?.toolName ?? settling.openToolName ?? 'unknown';
    const input = settling.input !== undefined ? toolInputJson(settling.input) : call?.input;
    this.calls.delete(toolCallId);
    this.committed.delete(toolCallId);
    const occurredAt = new Date().toISOString();
    const display = this.displays.get(toolCallId);
    const execution = this.executions.get(toolCallId);
    this.displays.delete(toolCallId);
    this.executions.delete(toolCallId);
    if (this.openForms.delete(toolCallId)) this.queue.dropTool(toolCallId);
    const entry = settledToolEntry(
      { id: toolEntryId(toolCallId), runId: this.runId, toolName: name, toolCallId, input, occurredAt },
      outcome,
      display,
      execution,
    );
    this.queue.push({ kind: 'tool-settled', entry });
  }

  provision(
    calls: readonly AgentStepToolCall[],
    occurredAt: string,
  ): { readonly entries: readonly ThreadToolEntry[]; readonly taken: readonly AgentStepToolCall[] } {
    const entries: ThreadToolEntry[] = [];
    const taken: AgentStepToolCall[] = [];
    for (const call of calls) {
      if (this.committed.has(call.toolCallId) || this.known.has(call.toolCallId)) continue;
      if (taken.some((one) => one.toolCallId === call.toolCallId)) continue;
      taken.push(call);
      entries.push({
        type: 'tool',
        id: toolEntryId(call.toolCallId),
        runId: this.runId,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        toolState: 'input-available',
        toolInput: toolInputJson(call.input),
        ...this.shownOf(call.toolCallId),
        occurredAt,
      });
    }
    return { entries, taken };
  }

  provisioned(taken: readonly AgentStepToolCall[]): void {
    for (const call of taken) {
      this.committed.add(call.toolCallId);
      this.calls.set(call.toolCallId, { toolName: call.toolName, input: toolInputJson(call.input) });
      this.openForms.delete(call.toolCallId);
      this.queue.dropTool(call.toolCallId);
    }
  }

  private shownOf(toolCallId: string): { readonly toolDisplay?: ToolDisplay; readonly execution?: ThreadToolExecution } {
    const display = this.displays.get(toolCallId);
    const execution = this.executions.get(toolCallId);
    return { toolDisplay: display, execution: execution };
  }

  private opened(toolCallId: string, change: ThreadToolChange): void {
    if (this.known.has(toolCallId)) return;
    const call = this.calls.get(toolCallId);
    if (!call) return;
    if (this.queue.amendTool(toolCallId, change)) return;
    this.openForms.add(toolCallId);
    this.queue.push({
      kind: 'entry',
      entry: {
        type: 'tool',
        id: toolEntryId(toolCallId),
        runId: this.runId,
        toolName: call.toolName,
        toolCallId,
        toolState: 'input-available',
        toolInput: call.input,
        ...this.shownOf(toolCallId),
        occurredAt: new Date().toISOString(),
      },
    });
  }
}
