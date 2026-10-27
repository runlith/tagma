import { Clock, Data, Deferred, Effect, Ref, Schema, Scope } from 'effect';
import type { ScreenAppearance } from '@runlith/executions/protocol/appearance';
import type { ExecutionLimits } from '@runlith/executions/protocol/capacity';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputProfile } from '@runlith/executions/protocol/inputProfile';
import type { ByteOffset } from '@runlith/executions/protocol/record';
import {
  detectScroll,
  presentationEncodeFullFrame,
  presentationEncodePatch,
  refusalAsUnavailable,
} from '@runlith/executions/protocol/presentationPaint';
import type { FrameRevision, ScreenAnswer, ScreenRead, ScreenRow, ScreenFeedItem } from '@runlith/executions/protocol/presentation';
import { screenAnswer } from '@runlith/executions/protocol/presentationText';
import type { Interpretation } from './Interpretation';
import { copyText, FRAME_ENVELOPE, sameStyle, ScreenMirror, stringBytes, type Copied } from './ScreenMirror';

type Shown = {
  readonly revision: FrameRevision;
};

type RevisionRecord = {
  readonly copied: Copied;
  readonly appearance: ScreenAppearance;
  readonly input: InputProfile;
};

type CachedProduce = {
  readonly moved: number;
  readonly revision: FrameRevision;
  readonly update: ScreenFeedItem;
};

export const ScreenViewerId = Schema.NonEmptyString.pipe(Schema.brand('ScreenViewerId'));
export type ScreenViewerId = typeof ScreenViewerId.Type;

export class ViewerUnknown extends Data.TaggedError('ViewerUnknown')<{ readonly viewer: typeof ScreenViewerId.Type }> {
  override get message(): string {
    return `viewer ${this.viewer} is not open`;
  }
}

export class FrameCreditRefused extends Data.TaggedError('FrameCreditRefused')<{
  readonly viewer: typeof ScreenViewerId.Type;
  readonly requested: number;
  readonly held: number;
  readonly limit: number;
}> {
  override get message(): string {
    return `viewer ${this.viewer} requested ${this.requested} credits with ${this.held} held under a limit of ${this.limit}`;
  }
}

type Viewer = {
  readonly shown: Shown | undefined;
  readonly credit: number;
  readonly producing: boolean;
  readonly stale: number;
  readonly shownAt: number;
  readonly waiting: Deferred.Deferred<boolean> | undefined;
};

type Taken = {
  readonly held: Viewer;
  readonly moved: number;
  readonly cached: CachedProduce | undefined;
};

type Screen = {
  readonly viewers: ReadonlyMap<ScreenViewerId, Viewer>;
  readonly revision: number;
  readonly moved: number;
  readonly movedAt: number;
  readonly records: ReadonlyMap<FrameRevision, RevisionRecord>;
  readonly produced: ReadonlyMap<FrameRevision | 'none', CachedProduce>;
  readonly ended: boolean;
};

export type Presentation = {
  readonly ref: ExecutionRef;
  readonly openViewer: (base?: FrameRevision) => Effect.Effect<ScreenViewerId, never, Scope.Scope>;
  readonly grant: (viewer: ScreenViewerId, frames: number) => Effect.Effect<number, ViewerUnknown | FrameCreditRefused>;
  readonly await: (viewer: ScreenViewerId) => Effect.Effect<boolean, ViewerUnknown>;
  readonly next: (viewer: ScreenViewerId) => Effect.Effect<ScreenFeedItem | undefined, ViewerUnknown>;
  readonly settled: (viewer: ScreenViewerId, quietMs: number) => Effect.Effect<boolean, ViewerUnknown>;
  readonly invalidate: () => Effect.Effect<void>;
  readonly ended: () => Effect.Effect<void>;
  readonly read: (request: ScreenRead) => Effect.Effect<ScreenAnswer>;
  readonly update: () => Effect.Effect<ScreenFeedItem>;
};

export const makePresentation = Effect.fnUntraced(function* ({
  interpretation,
  limits,
  ref,
}: {
  readonly interpretation: Interpretation;
  readonly limits: ExecutionLimits;
  readonly ref: ExecutionRef;
}) {
  const state = yield* Ref.make<Screen>({
    viewers: new Map(),
    revision: 0,
    moved: 0,
    movedAt: 0,
    ended: false,
    records: new Map(),
    produced: new Map(),
  });
  const mirror = new ScreenMirror(limits);
  yield* Effect.addFinalizer(() => Effect.sync(() => mirror.release()));
  const openViewer = Effect.fnUntraced(function* (base?: FrameRevision): Effect.fn.Return<ScreenViewerId, never, Scope.Scope> {
    const viewer = yield* Effect.acquireRelease(
      Effect.sync(() => ScreenViewerId.make(crypto.randomUUID())),
      (viewer) => closeViewer(viewer),
    );
    yield* Ref.update(state, (screen) => {
      const record = base === undefined ? undefined : screen.records.get(base);
      return {
        ...screen,
        viewers: new Map(screen.viewers).set(viewer, {
          shown: record === undefined || base === undefined ? undefined : { revision: base },
          credit: 0,
          producing: false,
          stale: screen.moved,
          shownAt: -1,
          waiting: undefined,
        }),
      };
    });
    return viewer;
  });

  function grant(viewer: ScreenViewerId, frames: number): Effect.Effect<number, ViewerUnknown | FrameCreditRefused> {
    const limit = limits.frame.inFlight;
    return decide(viewer, (held) => {
      if (!Number.isSafeInteger(frames) || frames <= 0) {
        return [
          Effect.fail(new FrameCreditRefused({ viewer, requested: Number.isSafeInteger(frames) ? frames : 0, held: held.credit, limit })),
          held,
        ];
      }
      const credit = held.credit + frames;
      if (credit > limit) return [Effect.fail(new FrameCreditRefused({ viewer, requested: frames, held: held.credit, limit })), held];
      return [Effect.succeed(credit), { ...held, credit }];
    });
  }

  function awaitFrame(viewer: ScreenViewerId): Effect.Effect<boolean, ViewerUnknown> {
    return Effect.flatten(
      decide<Effect.Effect<boolean, ViewerUnknown>, never>(viewer, (held, screen) => {
        if (held.shownAt < held.stale) return [Effect.succeed(Effect.succeed(true)), held];
        if (screen.ended) return [Effect.succeed(Effect.succeed(false)), held];
        const waiting = held.waiting ?? Deferred.makeUnsafe<boolean>();
        return [Effect.succeed(Deferred.await(waiting)), { ...held, waiting }];
      }),
    );
  }

  function next(viewer: ScreenViewerId): Effect.Effect<ScreenFeedItem | undefined, ViewerUnknown> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const taken = yield* decide<'skip' | Taken, never>(viewer, (held, screen) => {
          if (held.credit === 0 || held.producing || held.shownAt >= held.stale) {
            return [Effect.succeed('skip' as const), held];
          }
          const key = held.shown?.revision ?? 'none';
          const cached = screen.produced.get(key);
          if (cached !== undefined && cached.moved === screen.moved) {
            return [Effect.succeed({ held, moved: screen.moved, cached } satisfies Taken), held];
          }
          return [Effect.succeed({ held, moved: screen.moved, cached: undefined } satisfies Taken), { ...held, producing: true }];
        });
        if (taken === 'skip') return undefined;
        if (taken.cached !== undefined) {
          const { revision, update } = taken.cached;
          yield* decide<void, never>(viewer, (held) => [
            Effect.void,
            { ...held, credit: Math.max(0, held.credit - 1), shownAt: taken.held.stale, shown: { revision } },
          ]).pipe(Effect.catchTag('ViewerUnknown', () => Effect.void));
          return update;
        }
        const produced = yield* restore(produce(taken.held, taken.moved)).pipe(
          Effect.ensuring(
            decide<void, never>(viewer, (held) => [Effect.void, { ...held, producing: false }]).pipe(
              Effect.catchTag('ViewerUnknown', () => Effect.void),
            ),
          ),
        );
        yield* decide<void, never>(viewer, (held) => [
          Effect.void,
          {
            ...held,
            credit: Math.max(0, held.credit - 1),
            shownAt: taken.held.stale,
            shown: produced.shown ?? held.shown,
          },
        ]).pipe(Effect.catchTag('ViewerUnknown', () => Effect.void));
        return produced.update;
      }),
    );
  }

  const settled = Effect.fnUntraced(function* (viewer: ScreenViewerId, quietMs: number): Effect.fn.Return<boolean, ViewerUnknown> {
    if (!(yield* awaitFrame(viewer))) return false;
    for (;;) {
      const now = yield* Clock.currentTimeMillis;
      const left = yield* decide<number | 'ended', never>(viewer, (held, screen) => {
        if (screen.ended) return [Effect.succeed('ended' as const), held];
        const left = screen.movedAt + quietMs - now;
        return left > 0 ? [Effect.succeed(left), held] : [Effect.succeed(0), { ...held, shownAt: held.stale }];
      });
      if (left === 'ended') return false;
      if (left === 0) return true;
      yield* Effect.sleep(left);
    }
  });

  function invalidate(): Effect.Effect<void> {
    return Effect.flatMap(
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Ref.modify(state, (screen) => {
          const waiting: Deferred.Deferred<boolean>[] = [];
          const viewers = new Map<ScreenViewerId, Viewer>();
          const moved = screen.moved + 1;
          for (const [id, held] of screen.viewers) {
            if (held.waiting !== undefined) waiting.push(held.waiting);
            viewers.set(id, { ...held, stale: moved, waiting: undefined });
          }
          return [waiting, { ...screen, viewers, moved, movedAt: now }] as const;
        }),
      ),
      (waiting) => Effect.forEach(waiting, (deferred) => Deferred.succeed(deferred, true), { discard: true }),
    );
  }

  function ended(): Effect.Effect<void> {
    return Effect.flatMap(
      Ref.modify(state, (screen) => {
        const waiting: Deferred.Deferred<boolean>[] = [];
        const viewers = new Map<ScreenViewerId, Viewer>();
        for (const [id, held] of screen.viewers) {
          if (held.waiting !== undefined) waiting.push(held.waiting);
          viewers.set(id, { ...held, waiting: undefined });
        }
        return [waiting, { ...screen, viewers, ended: true }] as const;
      }),
      (waiting) => Effect.forEach(waiting, (deferred) => Deferred.succeed(deferred, false), { discard: true }),
    );
  }

  const read = Effect.fnUntraced(function* (request: ScreenRead): Effect.fn.Return<ScreenAnswer> {
    if (request.cells === true) return screenAnswer(yield* update(), true);
    const read = yield* Effect.result(
      Effect.withSpan(
        Effect.gen(function* () {
          const taken = yield* interpretation.read((engine) => copyText(engine, request.scrollback ?? 0));
          yield* Effect.annotateCurrentSpan({ rows: taken.value.rows.length });
          return taken;
        }),
        'copyText',
      ),
    );
    if (read._tag === 'Failure') {
      const failure = read.failure;
      return {
        _tag: 'ScreenUnavailable',
        ref: ref,
        parsedThrough: failure.parsedThrough,
        reason: failure.reason,
        detail: failure.detail,
      } satisfies ScreenAnswer;
    }
    const revision = (yield* Ref.modify(state, (screen) => [
      screen.revision + 1,
      { ...screen, revision: screen.revision + 1 },
    ])) as FrameRevision;
    return {
      _tag: 'ScreenTextFrame',
      provenance: { ref: ref, revision, parsedThrough: read.success.parsedThrough },
      buffer: read.success.value.buffer,
      geometry: read.success.value.geometry,
      rows: read.success.value.rows,
      cursor: read.success.value.cursor,
      input: read.success.input,
      title: read.success.appearance.title,
    } satisfies ScreenAnswer;
  });

  const update = Effect.fnUntraced(function* (): Effect.fn.Return<ScreenFeedItem> {
    const gated = yield* readGated();
    if (gated._tag === 'Ungated') return gated.update;
    const { copied, parsedThrough, appearance, input } = gated;
    const revision = (yield* Ref.modify(state, (screen) => [
      screen.revision + 1,
      { ...screen, revision: screen.revision + 1 },
    ])) as FrameRevision;
    return {
      _tag: 'ScreenFrame',
      provenance: { ref: ref, revision, parsedThrough },
      buffer: copied.buffer,
      geometry: copied.geometry,
      rows: copied.rows,
      cursor: copied.cursor,
      appearance,
      input,
    } satisfies ScreenFeedItem;
  });

  const readGated = Effect.fnUntraced(function* (): Effect.fn.Return<
    | {
        readonly _tag: 'Gated';
        readonly copied: Copied;
        readonly parsedThrough: ByteOffset;
        readonly appearance: ScreenAppearance;
        readonly input: InputProfile;
      }
    | { readonly _tag: 'Ungated'; readonly update: ScreenFeedItem },
    never
  > {
    const read = yield* Effect.result(
      Effect.withSpan(
        Effect.gen(function* () {
          const read = yield* interpretation.read((engine) => mirror.take(engine, interpretation.layout));
          yield* Effect.annotateCurrentSpan(
            read.value === 'oversized' ? { cells: 0 } : { cells: cellsOf(read.value), fresh: read.value.fresh },
          );
          return read;
        }),
        'copy',
      ),
    );
    if (read._tag === 'Failure') {
      const failure = read.failure;
      return {
        _tag: 'Ungated',
        update: {
          _tag: 'ScreenUnavailable',
          ref: ref,
          parsedThrough: failure.parsedThrough,
          reason: failure.reason,
          detail: failure.detail,
        } satisfies ScreenFeedItem,
      } as const;
    }
    if (read.success.value === 'oversized') {
      return {
        _tag: 'Ungated',
        update: {
          _tag: 'ScreenUnavailable',
          ref: ref,
          parsedThrough: read.success.parsedThrough,
          reason: 'budget',
          detail: `the visible screen does not fit the declared frame budget of ${limits.frame.bytes} bytes`,
        } satisfies ScreenFeedItem,
      } as const;
    }
    const { parsedThrough, appearance, input } = read.success;
    const copied = read.success.value;
    if (copied.spent + FRAME_ENVELOPE + stringBytes(appearance.title) > limits.frame.bytes) {
      return {
        _tag: 'Ungated',
        update: {
          _tag: 'ScreenUnavailable',
          ref: ref,
          parsedThrough,
          reason: 'budget',
          detail: `the screen and its ${stringBytes(appearance.title)}-byte title do not fit the declared frame budget of ${limits.frame.bytes} bytes`,
        } satisfies ScreenFeedItem,
      } as const;
    }
    return { _tag: 'Gated', copied, parsedThrough, appearance, input } as const;
  });

  const produce = Effect.fnUntraced(function* (
    held: Viewer,
    moved: number,
  ): Effect.fn.Return<{ readonly update: ScreenFeedItem; readonly shown: Shown | undefined }> {
    const gated = yield* readGated();
    if (gated._tag === 'Ungated') return { update: gated.update, shown: undefined };
    const { copied, parsedThrough, appearance, input } = gated;
    const revision = (yield* Ref.modify(state, (screen) => [
      screen.revision + 1,
      { ...screen, revision: screen.revision + 1 },
    ])) as FrameRevision;
    let base: { readonly revision: FrameRevision; readonly record: RevisionRecord } | undefined;
    if (held.shown !== undefined) {
      const record = (yield* Ref.get(state)).records.get(held.shown.revision);
      if (record !== undefined) base = { revision: held.shown.revision, record };
    }
    const baseKey = base?.revision ?? 'none';
    const scrollable = base !== undefined ? detectScroll(base.record.copied.rows, copied.rows, copied.geometry.rows) : undefined;
    const canPatch =
      base !== undefined &&
      (scrollable !== undefined || (sameDisplay(base.record.copied, copied) && !historyDiffered(base.record.copied, copied)));
    const screen = {
      buffer: copied.buffer,
      geometry: copied.geometry,
      rows: copied.rows,
      cursor: copied.cursor,
      appearance,
    };
    const framed =
      canPatch && base !== undefined
        ? presentationEncodePatch(
            {
              rows: base.record.copied.rows,
              viewportLine: base.record.copied.geometry.viewportLine,
              appearance: base.record.appearance,
            },
            screen,
          )
        : presentationEncodeFullFrame(screen);
    if (framed._tag === 'PaintRefused') {
      return { update: refusalAsUnavailable({ ref: ref, parsedThrough, refusal: framed }), shown: undefined };
    }
    const update: ScreenFeedItem =
      canPatch && base !== undefined
        ? ({
            _tag: 'ScreenProgramPatch',
            provenance: { ref: ref, base: base.revision, revision, parsedThrough },
            buffer: copied.buffer,
            geometry: copied.geometry,
            program: framed,
            input,
          } satisfies ScreenFeedItem)
        : ({
            _tag: 'ScreenProgramFrame',
            provenance: { ref: ref, revision, parsedThrough },
            buffer: copied.buffer,
            geometry: copied.geometry,
            program: framed,
            input,
          } satisfies ScreenFeedItem);
    if (wireBytes(update) > limits.frame.bytes) {
      return {
        update: {
          _tag: 'ScreenUnavailable',
          ref: ref,
          parsedThrough,
          reason: 'budget',
          detail: `the encoded program does not fit the declared frame budget of ${limits.frame.bytes} bytes`,
        } satisfies ScreenFeedItem,
        shown: undefined,
      };
    }
    yield* Ref.update(state, (screen) => {
      const records = new Map(screen.records);
      const produced = new Map(screen.produced);
      records.set(revision, { copied, appearance, input });
      produced.set(baseKey, { moved, revision, update });
      return sweepGenerations(screen, records, produced, revision);
    });
    return { update, shown: { revision } };
  });

  function closeViewer(viewer: ScreenViewerId): Effect.Effect<void> {
    return Effect.flatMap(
      Ref.modify(state, (screen) => {
        const held = screen.viewers.get(viewer);
        if (held === undefined) return [undefined, screen] as const;
        const viewers = new Map(screen.viewers);
        viewers.delete(viewer);
        return [held.waiting, { ...screen, viewers }] as const;
      }),
      (waiting) => (waiting === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(waiting, false))),
    );
  }

  function decide<A, E>(
    viewer: ScreenViewerId,
    f: (held: Viewer, screen: Screen) => readonly [Effect.Effect<A, E>, Viewer],
  ): Effect.Effect<A, E | ViewerUnknown> {
    return Effect.flatten(
      Ref.modify(state, (screen): readonly [Effect.Effect<A, E | ViewerUnknown>, Screen] => {
        const held = screen.viewers.get(viewer);
        if (held === undefined) return [Effect.fail(new ViewerUnknown({ viewer })), screen];
        const [answer, next] = f(held, screen);
        return [answer, { ...screen, viewers: new Map(screen.viewers).set(viewer, next) }];
      }),
    );
  }

  return {
    ref: ref,
    openViewer: openViewer,
    grant: grant,
    await: awaitFrame,
    next: next,
    settled: settled,
    invalidate: invalidate,
    ended: ended,
    read: read,
    update: update,
  } satisfies Presentation;
});

const sweepGenerations = (
  screen: Screen,
  records: Map<FrameRevision, RevisionRecord>,
  produced: Map<FrameRevision | 'none', CachedProduce>,
  fresh: FrameRevision,
): Screen => {
  for (const [key, entry] of produced) {
    if (entry.moved !== screen.moved) {
      produced.delete(key);
    } else if (key !== 'none' && ![...screen.viewers.values()].some((held) => held.shown?.revision === key)) {
      produced.delete(key);
    }
  }
  const keep = new Set<FrameRevision>([fresh]);
  for (const held of screen.viewers.values()) {
    if (held.shown !== undefined) keep.add(held.shown.revision);
  }
  for (const entry of produced.values()) keep.add(entry.revision);
  for (const revision of records.keys()) {
    if (!keep.has(revision)) records.delete(revision);
  }
  return { ...screen, records, produced };
};

const wireBytes = (update: ScreenFeedItem): number => new TextEncoder().encode(JSON.stringify(update)).length;

const sameDisplay = (shown: Copied, copied: Copied): boolean =>
  shown.buffer === copied.buffer &&
  shown.geometry.rows === copied.geometry.rows &&
  shown.geometry.columns === copied.geometry.columns &&
  shown.geometry.viewportLine === copied.geometry.viewportLine &&
  shown.geometry.firstLine === copied.geometry.firstLine;

const historyDiffered = (shown: Copied, copied: Copied): boolean => {
  const before = historyOf(shown);
  if (before !== historyOf(copied)) return true;
  for (let index = 0; index < before; index += 1) {
    if (!sameRow(shown.rows[index] as ScreenRow, copied.rows[index] as ScreenRow)) return true;
  }
  return false;
};

const historyOf = (copied: Copied): number => {
  let count = 0;
  while (count < copied.rows.length && (copied.rows[count] as ScreenRow).line < copied.geometry.viewportLine) count += 1;
  return count;
};

const sameRow = (a: ScreenRow, b: ScreenRow): boolean => {
  if (a === b) return true;
  if (a.wrapped !== b.wrapped || a.cells.length !== b.cells.length) return false;
  if (a.cells === b.cells) return true;
  for (let index = 0; index < a.cells.length; index += 1) {
    const left = a.cells[index]!;
    const right = b.cells[index]!;
    if (left === right) continue;
    if (left.chars !== right.chars || left.width !== right.width || !sameStyle(left.style, right.style)) return false;
  }
  return true;
};

const cellsOf = (copied: Copied): number => copied.rows.reduce((sum, row) => sum + row.cells.length, 0);
