import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { utf8Order } from '@runlith/utils/utf8';
import type { ThreadQuery } from '@runlith/agent/thread/ThreadQuery';
import type { ThreadQueryTarget } from '@runlith/agent/thread/ThreadIntrospection';
import { threadQuerySchema } from '../../threads/contract/wire/evidenceInput.js';
import {
  EvidenceReads,
  type EvidencePin,
  type EvidencePinnedThread,
  type EvidenceQuery,
  type EvidenceReader,
  type EvidenceStop,
  type PinnedEvidence,
} from '../../threads/contract/service/evidence.js';
import { conversationHeldSchema, type ConversationHeld } from '../../threads/contract/wire/conversation.js';
import { threadSelectionQuerySchema } from '../../threads/contract/wire/selection.js';
import { ThreadInputRefused, type HarnessFailure } from '../../threads/contract/service/failure.js';

const READ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const READER_ID = /^[0-9a-zA-Z-]{1,64}$/;

const pinnedRunSchema = Schema.StructWithRest(Schema.Struct({ runId: Schema.String.check(Schema.isMinLength(1)) }), [
  Schema.Record(Schema.String, Schema.Any),
]);

const pinnedThreadSchema = Schema.Struct({
  threadId: Schema.String.check(Schema.isMinLength(1)),
  facts: Schema.optional(
    Schema.Struct({
      head: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      runs: Schema.Array(pinnedRunSchema),
    }),
  ),
});

const askSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('query'), query: threadQuerySchema }),
  Schema.Struct({ kind: Schema.Literal('list'), selection: threadSelectionQuerySchema }),
]);

export const evidencePinSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  asks: askSchema,
  threads: Schema.Array(pinnedThreadSchema),
  pinnedAt: Schema.String.check(Schema.isMinLength(1)),
  selection: Schema.optional(Schema.String),
  named: Schema.optional(Schema.String),
  listing: Schema.optional(Schema.Struct({ reading: Schema.String, total: Schema.Int, project: Schema.Int })),
  activity: Schema.optional(
    Schema.Struct({
      project: Schema.Int,
      window: Schema.optional(
        Schema.Struct({ project: Schema.Int, since: Schema.optional(Schema.Number), before: Schema.optional(Schema.Number) }),
      ),
      members: Schema.optional(Schema.Literal(true)),
    }),
  ),
});

const stopSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('source'),
    at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    sourceKey: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('result'), at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
]);

const evidenceCursorSchema = Schema.Union([
  Schema.Struct({ k: Schema.Literal('r'), r: Schema.String.check(Schema.isMinLength(1)), stop: stopSchema }),
  Schema.Struct({
    k: Schema.Literal('d'),
    d: Schema.String.check(Schema.isMinLength(1)),
    mac: Schema.String.check(Schema.isMinLength(1)),
    stop: stopSchema,
  }),
]);

const decodeCursor = Schema.decodeUnknownEffect(evidenceCursorSchema);
const decodePin = Schema.decodeUnknownEffect(evidencePinSchema);

const resultSchema = Schema.Struct({
  rows: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Any))),
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        by: Schema.Record(Schema.String, Schema.Any),
        absent: Schema.optional(Schema.Array(Schema.String)),
        count: Schema.optional(Schema.Int),
        sum: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
        unknown: Schema.optional(Schema.Record(Schema.String, Schema.Int)),
      }),
    ),
  ),
  coverage: Schema.Struct({
    complete: Schema.Boolean,
    unavailable: Schema.Array(Schema.String),
    truncated: Schema.Boolean,
    read: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    cut: Schema.optional(Schema.Literal('read-ceiling')),
  }),
  walk: Schema.optional(stopSchema),
});

const decodeResult = Schema.decodeUnknownEffect(resultSchema);

const searchCursorSchema = Schema.Struct({ k: Schema.Literal('s'), s: Schema.String.check(Schema.isMinLength(1)) });
const decodeSearchCursor = Schema.decodeUnknownEffect(searchCursorSchema);
const decodeSearch = Schema.decodeUnknownEffect(conversationHeldSchema);

//! The operator pages from memory, so a bounded count of open searches and answers is kept and the oldest is let go.
const OPERATOR_HELD = 256;

export const evidenceReads = Effect.fnUntraced(function* (root: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const secret = randomUUID();
  const sign = (body: string): string => createHmac('sha256', secret).update(body).digest('base64url');
  const operatorResults = new Map<string, PinnedEvidence>();
  const operatorSearches = new Map<string, ConversationHeld>();

  const folder = (threadId: string): Effect.Effect<string, HarnessFailure> =>
    READER_ID.test(threadId)
      ? Effect.succeed(join(root, threadId))
      : Effect.fail(
          new ThreadInputRefused('not-found', `A reading is retained under a thread id: ${threadId}.`, ['name a thread of this project']),
        );

  const write = Effect.fnUntraced(
    function* (threadId: string, pin: EvidencePin) {
      const home = yield* folder(threadId);
      yield* fileSystem.makeDirectory(home, { recursive: true });
      yield* fileSystem.writeFileString(join(home, `${pin.id}.json`), JSON.stringify(pin));
    },
    Effect.mapError((cause) =>
      cause instanceof ThreadInputRefused
        ? cause
        : new ThreadInputRefused('read-not-retained', `This reading could not be retained: ${String(cause)}`, [
            'ask the query again, or narrow it so one answer holds it',
          ]),
    ),
  );

  const read = Effect.fnUntraced(function* (threadId: string, readId: string): Effect.fn.Return<EvidencePin, HarnessFailure> {
    if (!READ_ID.test(readId)) return yield* stale('This is not a reading this server issued.');
    const home = yield* folder(threadId);
    const body = yield* fileSystem.readFileString(join(home, `${readId}.json`)).pipe(Effect.mapError(readFailure));
    return yield* parsePin(body);
  });

  return EvidenceReads.of({
    pin: (reader, opened) => {
      const pin: EvidencePin = {
        ...opened,
        id: randomUUID(),
        pinnedAt: new Date().toISOString(),
        threads: opened.activity === undefined ? opened.threads : [],
        named: opened.activity === undefined ? undefined : digestNames(opened.threads.map((thread) => thread.threadId)),
        selection:
          opened.activity === undefined ? opened.selection : opened.selection === undefined ? undefined : digestText(opened.selection),
      };
      return reader.kind === 'operator' ? Effect.succeed(pin) : Effect.as(write(reader.threadId, pin), pin);
    },

    retain: (reader, pin, result) => {
      if (reader.kind === 'operator') return Effect.sync(() => kept(operatorResults, pin.id, result));
      return Effect.gen(function* () {
        const home = yield* folder(reader.threadId);
        yield* fileSystem.makeDirectory(home, { recursive: true });
        yield* fileSystem.writeFileString(join(home, `${pin.id}.answer.json`), JSON.stringify(result));
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof ThreadInputRefused
            ? cause
            : new ThreadInputRefused('read-not-retained', `This answer could not be retained: ${String(cause)}`, [
                'ask the query again with a smaller population, or a narrower limit',
              ]),
        ),
      );
    },

    held: (reader, pin) => {
      if (reader.kind === 'operator') return Effect.sync(() => operatorResults.get(pin.id) ?? null);
      return Effect.gen(function* () {
        if (!READ_ID.test(pin.id)) return null;
        const home = yield* folder(reader.threadId);
        const body = yield* fileSystem
          .readFileString(join(home, `${pin.id}.answer.json`))
          .pipe(
            Effect.catch((cause) =>
              (cause as { readonly reason?: { readonly _tag?: string } })?.reason?._tag === 'NotFound'
                ? Effect.succeed(null)
                : Effect.fail(readFailure(cause)),
            ),
          );
        if (body === null) return null;
        return yield* parseResult(body);
      });
    },

    cursor: (reader, pin, stop) => {
      if (stop === null) return null;
      const body = JSON.stringify(pin);
      const carried =
        reader.kind === 'operator' ? { k: 'd' as const, d: body, mac: sign(body), stop } : { k: 'r' as const, r: pin.id, stop };
      return Buffer.from(JSON.stringify(carried), 'utf8').toString('base64url');
    },

    resume: Effect.fnUntraced(function* (reader, cursor, question) {
      const carried = yield* parseCursor(cursor);
      const pin = yield* carried.k === 'd'
        ? carriedPin(carried, sign, reader)
        : reader.kind === 'operator'
          ? stale('This cursor names a reading retained for another reader.')
          : read(reader.threadId, carried.r);
      if (question !== undefined) {
        if (digestOf(pin.asks) !== digestOf(question.asks)) {
          return yield* stale('The question changed under this cursor.');
        }
        if (
          question.selection !== undefined &&
          (pin.activity === undefined ? question.selection : digestText(question.selection)) !== pin.selection
        )
          return yield* stale('The selection changed under this cursor.');
        if (
          question.threads.length > 0 &&
          !(pin.activity === undefined ? sameMembers(question.threads, pin.threads) : digestNames(question.threads) === pin.named)
        ) {
          return yield* stale('The threads named beside this cursor are not the ones it was opened over.');
        }
      }
      return { pin, from: yield* admitStop(pin, carried.stop) };
    }),

    release: Effect.fnUntraced(
      function* (threadId) {
        const home = yield* folder(threadId);
        yield* fileSystem.remove(home, { recursive: true, force: true });
      },
      (effect, threadId) =>
        Effect.mapError(effect, (cause) =>
          cause instanceof ThreadInputRefused
            ? cause
            : new ThreadInputRefused('read-not-released', `The readings of ${threadId} could not be released.`, [
                `remove ${join(root, threadId)} by hand once nothing is reading it`,
              ]),
        ),
    ),

    holdSearch: Effect.fnUntraced(function* (reader, held, cursor) {
      const id = cursor === null ? randomUUID() : yield* searchIdOf(cursor);
      if (reader.kind === 'operator') {
        kept(operatorSearches, id, held);
      } else {
        const home = yield* folder(reader.threadId);
        yield* fileSystem.makeDirectory(home, { recursive: true }).pipe(Effect.mapError(searchNotRetained));
        yield* fileSystem.writeFileString(join(home, `${id}.search.json`), JSON.stringify(held)).pipe(Effect.mapError(searchNotRetained));
      }
      return Buffer.from(JSON.stringify({ k: 's', s: id }), 'utf8').toString('base64url');
    }),

    heldSearch: Effect.fnUntraced(function* (reader, cursor) {
      const id = yield* searchIdOf(cursor);
      if (reader.kind === 'operator') {
        const held = operatorSearches.get(id);
        return held ?? (yield* stale('This search is no longer held.'));
      }
      const home = yield* folder(reader.threadId);
      const body = yield* fileSystem.readFileString(join(home, `${id}.search.json`)).pipe(Effect.mapError(readFailure));
      const value = yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: () => staleError('This search is no longer held in a form this server reads.'),
      });
      return yield* decodeSearch(value).pipe(
        Effect.mapError(() => staleError('This search is no longer held in a form this server reads.')),
      );
    }),
  });
});

function kept<A>(held: Map<string, A>, id: string, value: A): void {
  held.delete(id);
  held.set(id, value);
  for (const oldest of held.keys()) {
    if (held.size <= OPERATOR_HELD) break;
    held.delete(oldest);
  }
}

function searchIdOf(cursor: string): Effect.Effect<string, HarnessFailure> {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown,
    catch: () => staleError('This is not a cursor this search issued.'),
  }).pipe(
    Effect.flatMap((value) =>
      decodeSearchCursor(value).pipe(Effect.mapError(() => staleError('This is not a cursor this search issued.'))),
    ),
    Effect.flatMap((carried) => (READ_ID.test(carried.s) ? Effect.succeed(carried.s) : stale('This is not a cursor this search issued.'))),
  );
}

function searchNotRetained(cause: unknown): ThreadInputRefused {
  return new ThreadInputRefused('read-not-retained', `This search page could not be held: ${String(cause)}`, [
    'ask the search again without a cursor',
  ]);
}

const carriedPin = Effect.fnUntraced(function* (
  carried: { readonly d: string; readonly mac: string },
  sign: (body: string) => string,
  reader: EvidenceReader,
): Effect.fn.Return<EvidencePin, HarnessFailure> {
  if (reader.kind !== 'operator') {
    return yield* stale('This cursor carries a reading; a thread pages the one it retained.');
  }
  const held = Buffer.from(carried.mac, 'base64url');
  const mine = Buffer.from(sign(carried.d), 'base64url');
  if (held.length !== mine.length || !timingSafeEqual(held, mine)) {
    return yield* stale('This reading was not issued by this server.');
  }
  return yield* parsePin(carried.d);
});

function admitStop(pin: EvidencePin, stop: EvidenceStop): Effect.Effect<EvidenceStop, HarnessFailure> {
  if (stop.kind === 'result') {
    if (pin.asks.kind !== 'query' || (pin.asks.query.select !== 'activity' && !wholePopulation(pin.asks.query))) {
      return stale('This cursor continues a result this question does not produce.');
    }
    return Effect.succeed(stop);
  }
  if (stop.at > (pin.listing?.total ?? pin.threads.length)) return stale('This cursor stands past the reading it names.');
  if (stop.sourceKey === null) return Effect.succeed(stop);
  const target = pin.threads[stop.at];
  if (target === undefined) return stale('This cursor stands past the reading it names.');
  if (pin.asks.kind === 'list') return stale('A listing continues at a thread, never inside one.');
  const facts = target.facts;
  if (facts === undefined) return stale('This cursor names a thread this reading pinned nothing for.');
  const select = pin.asks.query.select;
  if (select === 'runs') {
    return facts.runs.some((run) => String(run.runId) === stop.sourceKey)
      ? Effect.succeed(stop)
      : stale(`This cursor names run ${stop.sourceKey}, which this reading did not pin.`);
  }
  const position = Number(stop.sourceKey);
  if (!Number.isInteger(position) || position < 0 || position > facts.head) {
    return stale(`This cursor stands outside the pinned log of ${target.threadId}.`);
  }
  return Effect.succeed(stop);
}

export function wholePopulation(query: ThreadQuery): boolean {
  return query.order !== undefined || query.count === true || (query.group ?? []).length > 0 || (query.sum ?? []).length > 0;
}

function parseCursor(cursor: string): Effect.Effect<typeof evidenceCursorSchema.Type, HarnessFailure> {
  return Effect.try({
    try: () => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown,
    catch: () => staleError('This is not a cursor this read issued.'),
  }).pipe(Effect.flatMap((held) => decodeCursor(held).pipe(Effect.mapError(() => staleError('This is not a cursor this read issued.')))));
}

function parsePin(held: string): Effect.Effect<EvidencePin, HarnessFailure> {
  return Effect.try({
    try: () => JSON.parse(held) as unknown,
    catch: () => corruptError('This reading is not readable JSON.'),
  }).pipe(
    Effect.flatMap((value) =>
      decodePin(value).pipe(Effect.mapError((issue) => corruptError(`This reading is not a descriptor this server wrote: ${issue}`))),
    ),
    Effect.map((pin) => pin as EvidencePin),
  );
}

function parseResult(held: string): Effect.Effect<PinnedEvidence, HarnessFailure> {
  return Effect.try({
    try: () => JSON.parse(held) as unknown,
    catch: () => corruptError('This retained answer is not readable JSON.'),
  }).pipe(
    Effect.flatMap((value) =>
      decodeResult(value).pipe(Effect.mapError(() => corruptError('This retained answer is not one this server wrote.'))),
    ),
    Effect.map((result) => result as PinnedEvidence),
  );
}

function readFailure(cause: unknown): ThreadInputRefused {
  const tag = (cause as { readonly reason?: { readonly _tag?: string } })?.reason?._tag;
  if (tag === 'NotFound') return staleError('This reading is no longer retained.');
  if (tag === 'PermissionDenied' || tag === 'BadResource') {
    return new ThreadInputRefused('read-inaccessible', `This reading could not be opened: ${String(cause)}`, [
      'ask the operator to check the permissions of the evidence read directory',
    ]);
  }
  return new ThreadInputRefused('read-failed', `This reading could not be read: ${String(cause)}`, [
    'try the continuation again',
    'ask the query again without a cursor to open a new reading',
  ]);
}

function staleError(reason: string): ThreadInputRefused {
  return new ThreadInputRefused('cursor-stale', reason, ['ask the query again without a cursor to open a new reading']);
}

function corruptError(reason: string): ThreadInputRefused {
  return new ThreadInputRefused('read-unreadable', reason, ['ask the query again without a cursor to open a new reading']);
}

function stale(reason: string): Effect.Effect<never, HarnessFailure> {
  return Effect.fail(staleError(reason));
}

function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function digestNames(names: readonly string[]): string {
  return digestText(JSON.stringify([...new Set(names)].sort()));
}

function sameMembers(named: readonly string[], pinned: readonly EvidencePinnedThread[]): boolean {
  if (named.length !== pinned.length) return false;
  const held = new Set(pinned.map((target) => target.threadId));
  return named.every((threadId) => held.has(threadId));
}

function digestOf(asks: EvidenceQuery): string {
  const question =
    asks.kind === 'query'
      ? { kind: asks.kind, query: without(asks.query, ['limit']) }
      : { kind: asks.kind, selection: without(asks.selection, ['limit', 'before']) };
  return createHmac('sha256', 'evidence-question').update(stable(question)).digest('hex').slice(0, 32);
}

function without<T extends object>(value: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([left], [right]) => utf8Order(left, right))
    .map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`)
    .join(',')}}`;
}

export function queryTargets(pin: EvidencePin): readonly ThreadQueryTarget[] {
  return pin.threads.flatMap((target) =>
    target.facts === undefined ? [] : [{ threadId: target.threadId, head: target.facts.head, runs: target.facts.runs }],
  );
}
