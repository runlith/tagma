import { Schema } from 'effect';
import { Usage } from '@runlith/acp/methods';
import type { ThreadEntry } from '@runlith/agent/transcript/entries';
import { compactionEntryId } from '@runlith/agent/transcript/entryNames';
import { COMPACTING, UNSTEPPED } from '@runlith/hosted-runner/wire/extensions';
import type { ProtocolRow } from '../row.js';
import { spendOf } from '../projection.js';
import { handled, settledBy, type Answering, type Handled, type Noticing, type Settled } from './declaration.js';

const CANCELLED = -32800;

const Meta = Schema.optional(Schema.Record(Schema.String, Schema.Unknown));

const Compacted = Schema.Struct({
  preTokens: Schema.optional(Schema.Number),
  postTokens: Schema.optional(Schema.NullOr(Schema.Number)),
  summary: Schema.String,
  usage: Schema.optional(Usage),
  _meta: Meta,
});

const Vendor = Schema.Struct({
  trigger: Schema.Literals(['manual', 'auto']),
  preTokens: Schema.optional(Schema.Number),
  postTokens: Schema.optional(Schema.Unknown),
  summary: Schema.String,
});

const decodeNotice = Schema.decodeUnknownResult(Compacted);

const decodeAttempt = Schema.decodeUnknownResult(Schema.Struct({ running: Schema.Boolean }));

const decodeVendor = Schema.decodeUnknownResult(Vendor);

const settled = settledBy(Compacted);

type Standing = NonNullable<ProtocolRow['compact']>;

type Mode = Standing['mode'];

type Summary = { readonly preTokens?: number; readonly postTokens?: number | null; readonly summary: string };

type Closing = 'running' | 'unchanged' | 'failed' | 'aborted';

const entryOf = (standing: Standing): string => compactionEntryId(standing.inTurn === undefined ? standing.turn : standing.request);

const completed = (id: string, runId: string | undefined, mode: Mode, summary: Summary, at: string): ThreadEntry => ({
  type: 'compaction',
  id,
  runId,
  mode,
  status: 'completed',
  occurredAt: at,
  updatedAt: at,
  summary: summary.summary,
  receipt: {
    cause: mode === 'manual' ? 'manual' : 'measured',
    measuredTokens: summary.preTokens,
    postTokens: summary.postTokens ?? undefined,
  },
});

const closed = (standing: Standing, status: Closing, at: string): ThreadEntry => ({
  type: 'compaction',
  id: entryOf(standing),
  runId: standing.turn,
  mode: standing.mode,
  status,
  occurredAt: at,
  updatedAt: at,
});

export const interruptedCompaction = (row: ProtocolRow, turns: readonly string[], at: string): ThreadEntry | null => {
  const standing = row.compact;
  return standing === null || !turns.includes(standing.turn) || standing.inTurn === 'armed' ? null : closed(standing, 'aborted', at);
};

const contextAfter = (row: ProtocolRow, read: Settled<typeof Compacted.Type>): ProtocolRow['context'] => {
  const after = read._tag === 'Answered' ? read.answer.postTokens : null;
  return after == null || row.context === null ? null : { used: after, size: row.context.size };
};

const stepAnswered = (row: ProtocolRow, standing: Standing, read: Settled<typeof Compacted.Type>, at: string): Handled => {
  const next = { ...row, compact: null, context: read._tag === 'Answered' ? contextAfter(row, read) : row.context };
  const settles = handled(next, [read.event]);
  if (read._tag === 'Answered')
    return {
      ...settles,
      boundaries: standing.noticed ? [] : [completed(entryOf(standing), standing.turn, standing.mode, read.answer, at)],
      fates: [{ _tag: 'Acknowledged', turn: standing.turn, ids: standing.ids }],
    };
  const code = read.cause._tag === 'Agent' ? read.cause.error.code : null;
  const started = standing.inTurn === 'compacting';
  const open = row.client.requests.some((request) => request.meaning === 'prompt' && request.turn === standing.turn);
  if (code === UNSTEPPED && !started && open) return settles;
  if (code === UNSTEPPED || read.cause._tag === 'Unwritten' || (code === CANCELLED && !started))
    return {
      ...settles,
      boundaries: started ? [closed(standing, 'failed', at)] : [],
      fates: [{ _tag: 'Returned', turn: standing.turn, envelopes: standing.ids }],
    };
  return {
    ...settles,
    boundaries: [closed(standing, code === CANCELLED ? 'aborted' : 'failed', at)],
    fates: [{ _tag: 'Acknowledged', turn: standing.turn, ids: standing.ids }],
  };
};

export const compact: Answering & Noticing = {
  refusal: null,
  noticed: (row, event, at) => {
    const standing = row.compact;
    if (event.method === COMPACTING) {
      const running = decodeAttempt(event.params);
      if (standing === null || running._tag === 'Failure') return handled(row);
      const started = running.success.running;
      if (standing.inTurn !== (started ? 'armed' : 'compacting')) return handled(row);
      return {
        ...handled({ ...row, compact: { ...standing, inTurn: started ? 'compacting' : 'armed' } }),
        boundaries: [closed(standing, started ? 'running' : 'unchanged', at)],
      };
    }
    const vendor = decodeVendor(event.params);
    if (standing === null || (standing.inTurn === undefined && vendor._tag === 'Success' && vendor.success.trigger === 'auto')) {
      if (vendor._tag === 'Failure') return handled(row);
      const read = vendor.success;
      const summary = { ...read, postTokens: typeof read.postTokens === 'number' ? read.postTokens : null };
      const mode = read.trigger === 'manual' ? 'manual' : 'automatic';
      return { ...handled(row), boundaries: [completed(compactionEntryId(event.id), row.turns.at(-1)?.id, mode, summary, at)] };
    }
    const decoded = decodeNotice(event.params);
    if (decoded._tag === 'Failure') return handled(row);
    return {
      ...handled({ ...row, compact: { ...standing, noticed: true } }),
      boundaries: [completed(entryOf(standing), standing.turn, standing.mode, decoded.success, at)],
    };
  },
  answered: (row, request, event, at) => {
    const standing = row.compact;
    if (standing === null || standing.request !== request.id) return handled(row);
    const read = settled(event);
    if (standing.inTurn !== undefined) return stepAnswered(row, standing, read, at);
    const spent = read._tag === 'Answered' ? read.answer : read.cause._tag === 'Agent' ? spendOf(read.cause.error.data) : null;
    const usage = spent?.usage ?? null;
    const meta = spent?._meta ?? null;
    const stopped = read._tag === 'Failed' && read.cause._tag === 'Agent' && read.cause.error.code === CANCELLED;
    const boundaries: ThreadEntry[] =
      read._tag === 'Answered'
        ? standing.noticed
          ? []
          : [completed(entryOf(standing), standing.turn, standing.mode, read.answer, at)]
        : [closed(standing, stopped ? 'aborted' : 'failed', at)];
    return {
      ...handled({ ...row, compact: null, context: contextAfter(row, read) }, [
        {
          _tag: 'TurnEnded',
          turn: standing.turn,
          envelopes: [],
          delivery: 'accepted',
          outcome:
            read._tag === 'Answered' || stopped
              ? { _tag: 'Stopped', stopReason: stopped ? 'cancelled' : 'end_turn', usage, meta }
              : { _tag: 'Failed', cause: read.cause, usage, meta },
        },
      ]),
      boundaries,
      fates: [{ _tag: 'Acknowledged', turn: standing.turn, ids: standing.ids }],
    };
  },
};
