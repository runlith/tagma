import { Clock, Effect, FileSystem } from 'effect';
import { commitOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import type { ChangeSource } from './changeSource';
import type { CheckoutFlights } from './CheckoutFlights';
import { type CursorReading, cursorReading } from './checkoutCursor';
import { type CheckoutFrontier, checkoutState, gitSaid, type Head, messageOf, quoted, type Reading } from './checkoutState';
import type { ResolvedToolOptions } from './workspace';

export type Place = {
  readonly tree: string | null;
  readonly ours: boolean;
};

export type PlaceReading = Place | { readonly refused: string };

const NO_HOLD = (): void => undefined;

export class CheckoutBaselines {
  private readonly places = new Map<string, Place>();

  constructor(private readonly flights: CheckoutFlights) {}

  readonly place = Effect.fn('CheckoutBaselines.place')(function* (
    this: CheckoutBaselines,
    workdir: string,
    resolved: ResolvedToolOptions,
  ): Effect.fn.Return<PlaceReading, never, FileSystem.FileSystem | Git> {
    const held = this.places.get(workdir);
    if (held !== undefined) return held;
    const found = yield* toplevelOf(workdir);
    if ('refused' in found) return { refused: found.refused };
    const tree = 'toplevel' in found ? found.toplevel : null;
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(resolved.cwd).pipe(
      Effect.map((real) => ({ real })),
      Effect.catchTag('PlatformError', (error) =>
        Effect.succeed({ refused: `the working directory ${quoted(resolved.cwd)} could not be resolved: ${error.reason._tag}` }),
      ),
    );
    if ('refused' in root) return { refused: root.refused };
    const place: Place = { tree, ours: tree !== null && tree === root.real };
    this.places.set(workdir, place);
    return place;
  });

  readonly hold = (tree: string): Effect.Effect<() => void> =>
    this.flights.source === null ? Effect.succeed(NO_HOLD) : this.flights.source.hold(tree);

  readonly measure = Effect.fn('CheckoutBaselines.measure')(function* (
    this: CheckoutBaselines,
    tree: string,
    resolved: ResolvedToolOptions,
  ): Effect.fn.Return<Reading, never, FileSystem.FileSystem | Git> {
    const services = yield* Effect.context<FileSystem.FileSystem | Git>();
    const source = this.flights.source;
    return yield* this.flights.join(
      resolved.world.files ?? resolved.world,
      `${tree}\0${resolved.cwd}\0${resolved.unowned.join('\0')}`,
      (frontier) => flightReading(tree, resolved, frontier, source).pipe(Effect.provideContext(services)),
    );
  });
}

const wholeReading = Effect.fn('CheckoutBaselines.wholeReading')(function* (
  tree: string,
  resolved: ResolvedToolOptions,
  frontier: CheckoutFrontier,
): Effect.fn.Return<CursorReading, never, FileSystem.FileSystem | Git> {
  const reading = yield* checkoutState(tree, resolved, frontier, null);
  const read = 'unreadable' in reading ? null : yield* commitOf(yield* Git, tree, 'HEAD').pipe(Effect.result);
  const head: Head =
    read === null ? { commit: null } : read._tag === 'Failure' ? { unread: quoted(read.failure.message) } : { commit: read.success };
  return { reading, head, heard: new Map() };
});

const flightReading = Effect.fn('CheckoutBaselines.flightReading')(function* (
  tree: string,
  resolved: ResolvedToolOptions,
  frontier: CheckoutFrontier,
  source: ChangeSource | null,
): Effect.fn.Return<Reading, never, FileSystem.FileSystem | Git> {
  const startedAt = yield* Clock.currentTimeMillis;
  frontier.begin();
  const { reading, head, heard } =
    source === null ? yield* wholeReading(tree, resolved, frontier) : yield* cursorReading(tree, resolved, frontier, source);
  if ('unreadable' in reading) {
    frontier.lost();
    return reading;
  }
  frontier.end();
  return { ...reading, heard, head, startedAt, endedAt: yield* Clock.currentTimeMillis };
});

export type HeadMove = { readonly from: string | null; readonly to: string | null } | { readonly unread: string };

export const headMove = (before: Reading | null, after: Reading | null): HeadMove | null => {
  if (before === null || after === null || 'unreadable' in before || 'unreadable' in after) return null;
  if ('unread' in before.head) return { unread: before.head.unread };
  if ('unread' in after.head) return { unread: after.head.unread };
  return before.head.commit === after.head.commit ? null : { from: before.head.commit, to: after.head.commit };
};

type Toplevel = { readonly toplevel: string } | { readonly absent: true } | { readonly refused: string };

const toplevelOf = Effect.fn('CheckoutBaselines.toplevelOf')(function* (
  workdir: string,
): Effect.fn.Return<Toplevel, never, FileSystem.FileSystem | Git> {
  const ran = yield* (yield* Git).run(['--no-optional-locks', 'rev-parse', '--show-toplevel'], { cwd: workdir }).pipe(Effect.result);
  if (ran._tag === 'Failure') return { refused: `git could not be run: ${quoted(messageOf(ran.failure))}` } satisfies Toplevel;
  const said = ran.success;
  if (said.overflow || said.messageOverflow) return { refused: 'git checkout identity exceeded its read boundary' } satisfies Toplevel;
  if (said.status !== 0) {
    if (/not a git repository/i.test(said.stderr)) return { absent: true } satisfies Toplevel;
    const diagnosis = said.stderr.trim() === '' ? `git rev-parse exited ${said.status}` : gitSaid(said.stderr, said.status);
    return { refused: `git said: ${quoted(diagnosis)}` } satisfies Toplevel;
  }
  if (said.stdout.trim() === '') return { absent: true } satisfies Toplevel;
  const fs = yield* FileSystem.FileSystem;
  const named = said.stdout.trim();
  return yield* fs.realPath(named).pipe(
    Effect.map((toplevel): Toplevel => ({ toplevel })),
    Effect.catchTag('PlatformError', (error) =>
      Effect.succeed<Toplevel>({
        refused: `git named ${quoted(named)} as the checkout, and it could not be resolved: ${error.reason._tag}`,
      }),
    ),
  );
});
