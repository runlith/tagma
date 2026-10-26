import { partialJsonReader, readPartialJsonState, type PartialJsonReader } from '@runlith/utils/json';
import type { AdapterDisplay } from './RunReports';
import { coreEntry } from '../../../transcript/kinds';
import { assistantMessageEntryId, hostedToolEntryId, reasoningEntryId } from '../../../transcript/entryNames';
import { interruptedInputEntry, type ThreadToolEntry, type ThreadToolInterruption } from '../../../transcript/entries';
import type { ThreadTranscript } from '../../../transcript/rows';
import type { ThreadFeed } from '../../ThreadPorts';
import type { ThreadRunRef } from '../ThreadRunLedger';
import { OpenParts, type OpenInputView, type OpenStream } from '../OpenParts';

export type TailDelta =
  | { readonly op: 'append'; readonly stream: OpenStream; readonly part: number; readonly text: string }
  | { readonly op: 'seal'; readonly stream: OpenStream; readonly part: number }
  | { readonly op: 'tool-input'; readonly callId: string; readonly name: string; readonly text: string }
  | { readonly op: 'retry' }
  | { readonly op: 'close' };

type Reading = { readonly reader: PartialJsonReader; fields: readonly string[] | null; complete: boolean };

type Tail = {
  readonly parts: OpenParts;
  readonly readings: Map<string, Reading>;
  retired: readonly OpenInputView[];
  changedAt: number | null;
};

const partId = (runId: string, stream: OpenStream, part: number): string =>
  stream === 'message' ? assistantMessageEntryId(runId, part) : reasoningEntryId(runId, part);

const interruptedOf = (
  run: ThreadRunRef,
  input: OpenInputView,
  interruption: ThreadToolInterruption | undefined,
  occurredAt: string,
): ThreadToolEntry =>
  interruptedInputEntry({
    id: input.id,
    runId: run.id,
    toolCallId: input.callId,
    toolName: input.name,
    received: { kind: 'text', text: input.text, complete: readPartialJsonState(input.text)?.complete ?? false },
    interruption,
    display: input.display,
    occurredAt,
  });

export class RunTails {
  private readonly tails = new Map<string, Tail>();

  constructor(
    private readonly feed: ThreadFeed['Service'],
    private readonly clock: () => number,
    private readonly everyMs: number,
  ) {}

  due(run: ThreadRunRef): boolean {
    const changedAt = this.tails.get(run.id)?.changedAt ?? null;
    return changedAt !== null && this.clock() - changedAt >= this.everyMs;
  }

  apply(run: ThreadRunRef, delta: TailDelta, display: AdapterDisplay | undefined): void {
    if (delta.op === 'close') return this.close(run);
    const tail = this.tailOf(run.id);
    tail.changedAt ??= this.clock();
    if (delta.op === 'tool-input') return this.input(run, tail, delta, display);
    if (delta.op === 'retry') return this.retry(run, tail);
    const id = partId(run.id, delta.stream, delta.part);
    if (delta.op === 'seal') {
      tail.parts.seal(id);
      return;
    }
    const standing = tail.parts.opened(delta.stream);
    if (standing !== undefined && standing !== id) tail.parts.seal(standing);
    tail.parts.open(delta.stream, id, () => id);
    const growth = tail.parts.append(id, delta.text);
    if (growth === null) return;
    if (growth.opened) this.feed.tail(run.threadId, run.id, tail.parts.tail(), []);
    else this.feed.append(run.threadId, run.id, growth.id, growth.text);
  }

  landed(run: ThreadRunRef, written: ReadonlySet<string>): void {
    const tail = this.tails.get(run.id);
    if (tail === undefined) return;
    const gone = tail.parts.landed(written);
    for (const input of [...tail.readings.keys()]) if (tail.parts.input(input) === undefined) tail.readings.delete(input);
    if (gone.length > 0) this.feed.tail(run.threadId, run.id, tail.parts.tail(), gone);
  }

  retired(run: ThreadRunRef, interruption: ThreadToolInterruption, occurredAt: string): readonly ThreadToolEntry[] {
    const tail = this.tails.get(run.id);
    if (tail === undefined) return [];
    const retired = tail.retired;
    tail.retired = [];
    return retired.map((input) => interruptedOf(run, input, interruption, occurredAt));
  }

  snapshot(run: ThreadRunRef, ending: boolean): ThreadTranscript {
    const tail = this.tails.get(run.id);
    if (tail === undefined) return [];
    tail.changedAt = null;
    const open = tail.parts.tail();
    if (!ending) return open;
    const at = this.now();
    const interrupted = new Map(tail.parts.inputs().map((input) => [input.id, interruptedOf(run, input, undefined, at)]));
    return open.map((entry) => interrupted.get(entry.id) ?? entry);
  }

  seed(run: ThreadRunRef, tail: ThreadTranscript): void {
    const inputs = tail.filter(
      (entry): entry is ThreadToolEntry => coreEntry(entry) && entry.type === 'tool' && entry.toolInputRaw?.kind === 'text',
    );
    if (inputs.length === 0) return;
    const seeded = this.tailOf(run.id);
    for (const entry of inputs) {
      if (seeded.parts.input(entry.toolCallId) !== undefined || entry.toolInputRaw?.kind !== 'text') continue;
      const text = entry.toolInputRaw.text;
      seeded.parts.appendInput(entry.toolCallId, entry.toolName, entry.id, text);
      seeded.parts.showInput(entry.toolCallId, entry.toolDisplay);
      const reader = partialJsonReader();
      const state = text.length === 0 ? undefined : reader.push(text);
      seeded.readings.set(entry.toolCallId, { reader, fields: state?.completedFields ?? null, complete: state?.complete ?? false });
    }
  }

  private retry(run: ThreadRunRef, tail: Tail): void {
    const inputs = tail.parts.inputs();
    if (inputs.length === 0) return;
    for (const input of inputs) {
      tail.parts.dropInput(input.callId);
      tail.readings.delete(input.callId);
    }
    tail.retired = [...tail.retired, ...inputs];
    this.feed.tail(
      run.threadId,
      run.id,
      tail.parts.tail(),
      inputs.map((input) => input.id),
    );
  }

  private input(
    run: ThreadRunRef,
    tail: Tail,
    delta: Extract<TailDelta, { readonly op: 'tool-input' }>,
    display: AdapterDisplay | undefined,
  ): void {
    const growth = tail.parts.appendInput(delta.callId, delta.name, hostedToolEntryId(run.id, delta.callId), delta.text);
    const shown = display === undefined ? false : this.displayed(run, tail, delta, display);
    if (growth === null && !shown) {
      if (tail.parts.input(delta.callId)?.text === '') this.feed.tail(run.threadId, run.id, tail.parts.tail(), []);
      return;
    }
    if (growth !== null && !growth.opened && !shown) this.feed.append(run.threadId, run.id, growth.id, growth.text);
    else this.feed.tail(run.threadId, run.id, tail.parts.tail(), []);
  }

  private displayed(
    run: ThreadRunRef,
    tail: Tail,
    delta: Extract<TailDelta, { readonly op: 'tool-input' }>,
    display: AdapterDisplay,
  ): boolean {
    let reading = tail.readings.get(delta.callId);
    if (reading === undefined) {
      reading = { reader: partialJsonReader(), fields: null, complete: false };
      tail.readings.set(delta.callId, reading);
    }
    const state = delta.text.length === 0 ? undefined : reading.reader.push(delta.text);
    if (state === undefined || (reading.fields === state.completedFields && reading.complete === state.complete)) return false;
    reading.fields = state.completedFields;
    reading.complete = state.complete;
    const shown = display(run.threadId, delta.name, state);
    if (shown === undefined || shown.title === tail.parts.input(delta.callId)?.display?.title) return false;
    tail.parts.showInput(delta.callId, shown);
    return true;
  }

  private now(): string {
    return new Date(this.clock()).toISOString();
  }

  private close(run: ThreadRunRef): void {
    const tail = this.tails.get(run.id);
    if (tail === undefined) return;
    this.tails.delete(run.id);
    const ids = tail.parts.end();
    if (ids.length > 0) this.feed.tail(run.threadId, run.id, [], ids);
  }

  private tailOf(runId: string): Tail {
    const standing = this.tails.get(runId);
    if (standing !== undefined) return standing;
    const tail: Tail = { parts: new OpenParts(runId, () => this.now()), readings: new Map(), retired: [], changedAt: null };
    this.tails.set(runId, tail);
    return tail;
  }
}
