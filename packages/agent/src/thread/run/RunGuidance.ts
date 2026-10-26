import { Clock, Context, Effect, Layer, Semaphore } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { AgentRuntimeGuidance } from '../../agent/contracts';
import { threadGuidanceEvent, type ThreadEventBody } from '../events';
import type { ThreadBorderFailed } from '../ThreadBorder';
import { ThreadStore } from '../ThreadPorts';
import type { GuidanceLaw, GuidanceTail, LaunchGuidance } from '../transport/contract';
export type TouchLedger = {
  readonly delivered: Set<string>;
  readonly heard: Set<string>;
};
type Touched = {
  readonly delivered: readonly string[];
  readonly heard: readonly string[];
};
type Delivered = {
  readonly oriented: boolean;
  readonly law: unknown;
  readonly recap: boolean;
  readonly touched: Touched;
};
const PROMPT_RULE = 'prompt';
const NOTHING_TOUCHED: Touched = { delivered: [], heard: [] };
const SCRATCH: Delivered = { oriented: false, law: null, recap: false, touched: NOTHING_TOUCHED };
const PAGE = { limit: 200, bytes: 262_144 } as const;
const recapBlock = (recap: string | null): string =>
  `<thread-history>\nThis is the history of this Tagma thread before its agent session was replaced; it is context, not a request.\n\n${recap ?? 'Tagma holds no recap of the earlier conversation.'}\n</thread-history>`;
const lawBlock = (text: string): string => `<runtime-guidance>\n${text}\n</runtime-guidance>`;
const stateOf = (frame: AgentRuntimeGuidance): Delivered | null => {
  const source = frame.sources.find((each) => each.ruleId === PROMPT_RULE);
  const state = source?.state;
  return state === undefined
    ? null
    : { oriented: state.oriented === true, law: state.law ?? null, recap: state.recap === true, touched: touchedOf(state.touched) };
};
const namesOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];
const touchedOf = (value: unknown): Touched => {
  if (value === null || typeof value !== 'object') return NOTHING_TOUCHED;
  const shape = value as Record<string, unknown>;
  return { delivered: namesOf(shape.delivered), heard: namesOf(shape.heard) };
};
export type ClearedFrame = {
  readonly events: readonly ThreadEventBody[];
  readonly delivered: Effect.Effect<void>;
};
const hookFrameId = (evidence: string): string => `transcript:runtime-guidance:hook:${evidence}`;
const tailFrame = (runId: string, tail: GuidanceTail, at: number): AgentRuntimeGuidance => ({
  type: 'runtime-guidance',
  id: `transcript:runtime-guidance:${uuidv7()}`,
  runId,
  hook: 'beforeStep',
  sequence: 1,
  texts: [tail.text],
  sources: [{ hook: 'beforeStep', ruleId: tail.ruleId, state: tail.state, retell: false }],
  ruleIds: [tail.ruleId],
  occurredAt: new Date(at).toISOString(),
});
export class RunGuidance extends Context.Service<
  RunGuidance,
  LaunchGuidance & {
    hook<E>(
      threadId: string,
      runId: string,
      evidence: string,
      decide: (ledger: TouchLedger) => string | null,
      record: (events: readonly ThreadEventBody[]) => Effect.Effect<void, E>,
      options?: {
        readonly law?: (delivered: unknown) => Effect.Effect<GuidanceLaw, E>;
      },
    ): Effect.Effect<string | null, ThreadBorderFailed | E>;
    cleared(threadId: string, runId: string, recap: boolean): Effect.Effect<ClearedFrame, ThreadBorderFailed>;
  }
>()('@runlith/agent/RunGuidance') {}
export const runGuidanceLayer = Layer.effect(
  RunGuidance,
  Effect.gen(function* () {
    const store = yield* ThreadStore;
    const projection = new Map<string, Delivered>();
    const locks = new Map<string, Semaphore.Semaphore>();
    const lockOf = (threadId: string): Semaphore.Semaphore => {
      const held = locks.get(threadId) ?? Semaphore.makeUnsafe(1);
      locks.set(threadId, held);
      return held;
    };
    const folded = Effect.fn('RunGuidance.folded')(function* (threadId: string): Effect.fn.Return<Delivered, ThreadBorderFailed> {
      let before: number | undefined;
      for (;;) {
        const page = yield* store.transcriptWindow(threadId, { ...PAGE, before: before });
        if (page === null) return SCRATCH;
        for (const entry of page.entries.toReversed()) {
          if (entry.type === 'compaction' && 'status' in entry && entry.status === 'completed') return SCRATCH;
          if (entry.type !== 'runtime-guidance') continue;
          const state = stateOf(entry as AgentRuntimeGuidance);
          if (state !== null) return state;
        }
        if (page.before === null) return SCRATCH;
        before = page.before;
      }
    });
    const standing = (threadId: string): Effect.Effect<Delivered, ThreadBorderFailed> => {
      const held = projection.get(threadId);
      if (held !== undefined) return Effect.succeed(held);
      return Effect.tap(folded(threadId), (scanned) => Effect.sync(() => void projection.set(threadId, scanned)));
    };
    return RunGuidance.of({
      hook: (threadId, runId, evidence, decide, record, options) =>
        lockOf(threadId).withPermit(
          Effect.gen(function* () {
            const told = yield* store.entryById(threadId, hookFrameId(evidence));
            if (told?.type === 'runtime-guidance') return (told as AgentRuntimeGuidance).texts[0] ?? null;
            const was = yield* standing(threadId);
            const delivered = new Set(was.touched.delivered);
            const heard = new Set(was.touched.heard);
            const moved = options?.law === undefined ? { text: '', law: was.law } : yield* options.law(was.law);
            const local = decide({ delivered, heard });
            const text = [moved.text === '' ? null : lawBlock(moved.text), local].filter((line) => line !== null).join('\n\n');
            if (text === '') return null;
            const touched: Touched = { delivered: [...delivered], heard: [...heard] };
            const next: Delivered = { ...was, law: moved.law, touched };
            const frame: AgentRuntimeGuidance = {
              type: 'runtime-guidance',
              id: hookFrameId(evidence),
              runId,
              hook: 'afterTool',
              sequence: 1,
              texts: [text],
              sources: [
                { hook: 'afterTool', ruleId: PROMPT_RULE, state: { oriented: next.oriented, law: next.law, recap: next.recap, touched } },
              ],
              occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            };
            yield* record([threadGuidanceEvent(frame)]);
            projection.set(threadId, next);
            return text;
          }),
        ),
      cleared: Effect.fnUntraced(function* (threadId, runId, recap) {
        const frame: AgentRuntimeGuidance = {
          type: 'runtime-guidance',
          id: `transcript:runtime-guidance:${uuidv7()}`,
          runId,
          hook: 'afterTool',
          sequence: 1,
          texts: [],
          sources: [
            {
              hook: 'afterTool',
              ruleId: PROMPT_RULE,
              state: { oriented: false, law: null, recap, touched: NOTHING_TOUCHED },
            },
          ],
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        return {
          events: [threadGuidanceEvent(frame)],
          delivered: lockOf(threadId).withPermit(Effect.sync(() => void projection.set(threadId, { ...SCRATCH, recap }))),
        };
      }),
      reset: (threadId, recap) => void projection.set(threadId, { ...SCRATCH, recap }),
      notes: Effect.fn('RunGuidance.notes')(function* (threadId, runId, words, sources) {
        const tail = words.inputs.length === 0 ? null : yield* sources.tail(threadId, words);
        return tail === null ? null : { text: tail.text, frame: tailFrame(runId, tail, yield* Clock.currentTimeMillis) };
      }),
      prompt: Effect.fn('RunGuidance.prompt')(function* (thread, run, words, sources) {
        const was = yield* standing(thread.id);
        const texts: string[] = [];
        let next: Delivered = was;
        if (!was.oriented) {
          const oriented = yield* sources.orientation(thread);
          texts.push(...oriented.texts);
          next = { oriented: true, law: oriented.law, recap: was.recap, touched: was.touched };
        } else {
          const moved = yield* sources.law(thread, was.law);
          if (moved.text !== '') texts.push(lawBlock(moved.text));
          next = { oriented: true, law: moved.law, recap: was.recap, touched: was.touched };
        }
        if (was.recap) {
          texts.push(recapBlock(yield* sources.recap(thread)));
          next = { ...next, recap: false };
        }
        const frame: AgentRuntimeGuidance = {
          type: 'runtime-guidance',
          id: `transcript:runtime-guidance:${uuidv7()}`,
          runId: run.id,
          hook: 'beforeStep',
          sequence: 1,
          texts,
          sources: texts.map((_, index) => ({
            hook: 'beforeStep' as const,
            ruleId: PROMPT_RULE,
            state: index === 0 ? { oriented: next.oriented, law: next.law, recap: next.recap, touched: next.touched } : undefined,
          })),
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        };
        const tail = words.inputs.length === 0 ? null : yield* sources.tail(thread.id, words);
        return {
          texts,
          tail: tail === null ? null : { text: tail.text, frame: tailFrame(run.id, tail, yield* Clock.currentTimeMillis) },
          events: texts.length === 0 ? [] : [threadGuidanceEvent(frame)],
          delivered: Effect.sync(() => void projection.set(thread.id, next)),
        };
      }),
    });
  }),
);
