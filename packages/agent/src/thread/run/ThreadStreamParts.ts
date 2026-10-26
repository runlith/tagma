import type { ToolDisplay } from '../../tool/display';
import { assistantMessageEntryId, reasoningEntryId, threadPartOrdinals, toolEntryId } from '../../transcript/entryNames';
import type { ThreadTranscript, ThreadTranscriptEntry } from '../../transcript/rows';
import type { ThreadInterruptedInput } from '../../transcript/entries';
import type { ThreadOpenInputHold } from '../toolOutputs';
import type { ThreadFactQueue } from './ThreadFactQueue';
import { OpenParts, type PartGrowth } from './OpenParts';

export type ThreadOpenToolInput = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly inputText: string;
  readonly held: ThreadOpenInputHold | null;
};

export type ThreadPartGrowth = PartGrowth;

const streamOf = (kind: 'text' | 'reasoning') => (kind === 'text' ? 'message' : 'reasoning');

export class ThreadStreamParts {
  private readonly open: OpenParts;
  private readonly held = new Map<string, ThreadOpenInputHold | null>();
  private textIndex: number;
  private reasoningIndex: number;

  constructor(
    private readonly runId: string,
    private readonly queue: ThreadFactQueue,
    runEntries: ThreadTranscript,
  ) {
    const from = threadPartOrdinals(runEntries);
    this.textIndex = from.text;
    this.reasoningIndex = from.reasoning;
    this.open = new OpenParts(runId, () => new Date().toISOString());
  }

  idle(): boolean {
    return this.open.idle();
  }

  start(kind: 'text' | 'reasoning', id: string): void {
    this.open.open(streamOf(kind), `${kind}:${id}`, () =>
      kind === 'text' ? assistantMessageEntryId(this.runId, this.textIndex++) : reasoningEntryId(this.runId, this.reasoningIndex++),
    );
  }

  append(kind: 'text' | 'reasoning', id: string, text: string): ThreadPartGrowth | null {
    return this.open.append(`${kind}:${id}`, text);
  }

  close(kind: 'text' | 'reasoning', id: string): void {
    const entry = this.open.seal(`${kind}:${id}`);
    if (entry === null) return;
    this.open.landed(new Set([entry.id]));
    this.queue.push(entry.type === 'message' ? { kind: 'replay', entry } : { kind: 'entry', entry });
  }

  closeAtStep(): void {
    for (const kind of ['text', 'reasoning'] as const) {
      for (let key = this.open.opened(streamOf(kind)); key !== undefined; key = this.open.opened(streamOf(kind))) {
        this.close(kind, key.slice(kind.length + 1));
      }
    }
  }

  startToolInput(toolCallId: string, toolName: string): void {
    this.open.openInput(toolCallId, toolName, toolEntryId(toolCallId));
  }

  appendToolInput(toolCallId: string, toolName: string, text: string): ThreadPartGrowth | null {
    const growth = this.open.appendInput(toolCallId, toolName, toolEntryId(toolCallId), text);
    return this.held.get(toolCallId)?.input.kind === 'retained' ? null : growth;
  }

  openToolInputs(): readonly ThreadOpenToolInput[] {
    return this.open
      .inputs()
      .map((input) => ({
        toolCallId: input.callId,
        toolName: input.name,
        inputText: input.text,
        held: this.held.get(input.callId) ?? null,
      }));
  }

  holdToolInput(toolCallId: string, held: ThreadOpenInputHold | null): void {
    if (this.open.input(toolCallId) !== undefined) this.held.set(toolCallId, held);
  }

  dropToolInput(toolCallId: string): { readonly toolName: string; readonly inputText: string } | undefined {
    this.held.delete(toolCallId);
    const input = this.open.dropInput(toolCallId);
    return input === undefined ? undefined : { toolName: input.name, inputText: input.text };
  }

  tail(
    displayOf: (toolCallId: string) => ToolDisplay | undefined,
    retained: ReadonlyMap<string, ThreadInterruptedInput> = new Map(),
  ): readonly ThreadTranscriptEntry[] {
    return this.open.tail((input) => {
      const hold = this.held.get(input.callId)?.input;
      return {
        raw:
          retained.get(input.callId) ??
          (hold?.kind === 'retained' ? hold : undefined) ??
          (input.text.length > 0 ? { kind: 'text', text: input.text, complete: false } : undefined),
        display: displayOf(input.callId),
      };
    });
  }
}
