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

const compactionOf = (raw: unknown): Item | null => {
  const read = Schema.decodeUnknownResult(Item)(raw);
  return Result.isSuccess(read) && read.success.kind === 'compaction' ? read.success : null;
};

export class Compactions {
  private readonly recorded = new Set<string>();
  private readonly doubted = new Set<string>();

  doubt(session: string): void {
    this.doubted.add(session);
  }

  record(itemId: string): void {
    this.recorded.add(itemId);
  }

  delivered(frame: Frame): void {
    const item = frame.method === 'item/completed' ? compactionOf(frame.params.item) : null;
    if (item !== null) this.recorded.add(item.itemId);
  }

  readonly reconcile = Effect.fnUntraced(function* (
    this: Compactions,
    host: Host,
    session: string,
    out: Output,
    stderr: (text: string) => void,
  ) {
    if (!this.doubted.has(session)) return;
    const served = yield* host.request('session/read', { sessionId: session, excludeItems: false });
    this.doubted.delete(session);
    const read = Schema.decodeUnknownResult(Served)(served);
    const history = Result.isSuccess(read) ? read.success.history : null;
    const held = history?.snapshot?.state.items ?? (history?.mode === 'inline' ? (history.items ?? null) : null);
    if (held === null)
      return stderr(
        `Muse Code cannot show whether a compaction a stop cut off completed: ${Result.isFailure(read) ? read.failure.message : `it served the history as ${history?.mode}`}\n`,
      );
    const last = held.flatMap((raw) => compactionOf(raw) ?? []).at(-1);
    if (last === undefined || last.outcome !== 'compacted' || this.recorded.has(last.itemId)) return;
    this.recorded.add(last.itemId);
    yield* out.event({
      type: 'compacted',
      summary: '',
      trigger: last.trigger === 'manual' ? 'manual' : 'auto',
      preTokens: last.tokensBefore,
      postTokens: last.tokensAfter,
    });
  });
}
