import { Effect, Result, Schema } from 'effect';
import type { Output } from '@runlith/hosted-runner/output';
import type { Frame, Host } from './channel.js';
import { Item } from './frames.js';

const Served = Schema.Struct({
  history: Schema.Struct({
    mode: Schema.String,
    items: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
    snapshot: Schema.optional(Schema.NullOr(Schema.Struct({ state: Schema.Struct({ items: Schema.Array(Schema.Unknown) }) }))),
  }),
});

const Kept = Schema.Struct({ recorded: Schema.NullOr(Schema.String), doubted: Schema.Boolean });
type Kept = typeof Kept.Type;

const NONE: Kept = { recorded: null, doubted: false };

type CompactionStore = {
  readonly read: (session: string) => Effect.Effect<string | null>;
  readonly write: (session: string, text: string) => Effect.Effect<void>;
};

const compactionOf = (raw: unknown): Item | null => {
  const read = Schema.decodeUnknownResult(Item)(raw);
  return Result.isSuccess(read) && read.success.kind === 'compaction' ? read.success : null;
};

const parsed = (text: string | null): Kept => {
  if (text === null) return NONE;
  try {
    const read = Schema.decodeUnknownResult(Kept)(JSON.parse(text));
    return Result.isSuccess(read) ? read.success : NONE;
  } catch {
    return NONE;
  }
};

export class Compactions {
  private readonly states = new Map<string, Kept>();

  constructor(private readonly store: CompactionStore) {}

  private readonly state = Effect.fnUntraced(function* (this: Compactions, session: string) {
    const known = this.states.get(session);
    if (known !== undefined) return known;
    const kept = parsed(yield* this.store.read(session));
    this.states.set(session, kept);
    return kept;
  });

  private readonly put = Effect.fnUntraced(function* (this: Compactions, session: string, kept: Kept) {
    this.states.set(session, kept);
    yield* this.store.write(session, JSON.stringify(kept));
  });

  readonly doubt = Effect.fnUntraced(function* (this: Compactions, session: string) {
    const kept = yield* this.state(session);
    if (!kept.doubted) yield* this.put(session, { ...kept, doubted: true });
  });

  readonly record = Effect.fnUntraced(function* (this: Compactions, session: string, itemId: string) {
    const kept = yield* this.state(session);
    yield* this.put(session, { ...kept, recorded: itemId });
  });

  delivered(frame: Frame): Effect.Effect<void> {
    const item = frame.method === 'item/completed' ? compactionOf(frame.params.item) : null;
    const session = frame.params.sessionId;
    return item === null || typeof session !== 'string' ? Effect.void : this.record(session, item.itemId);
  }

  readonly reconcile = Effect.fnUntraced(function* (
    this: Compactions,
    host: Host,
    session: string,
    out: Output,
    stderr: (text: string) => void,
  ) {
    const kept = yield* this.state(session);
    if (!kept.doubted) return;
    const served = yield* host.request('session/read', { sessionId: session, excludeItems: false });
    const read = Schema.decodeUnknownResult(Served)(served);
    const history = Result.isSuccess(read) ? read.success.history : null;
    const held = history?.snapshot?.state.items ?? (history?.mode === 'inline' ? (history.items ?? null) : null);
    if (held === null)
      return stderr(
        `Muse Code cannot show yet whether a compaction a stop cut off completed: ${Result.isFailure(read) ? read.failure.message : `it served the history as ${history?.mode}`}\n`,
      );
    const last = held.flatMap((raw) => compactionOf(raw) ?? []).at(-1);
    if (last === undefined || last.outcome !== 'compacted' || last.itemId === kept.recorded)
      return yield* this.put(session, { ...kept, doubted: false });
    yield* out.event({ type: 'compacted', summary: '', trigger: 'auto', preTokens: last.tokensBefore, postTokens: last.tokensAfter });
    yield* this.put(session, { recorded: last.itemId, doubted: false });
  });
}
