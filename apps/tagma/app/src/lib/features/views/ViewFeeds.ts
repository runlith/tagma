import { Stream } from 'effect';
import type { LiveConnection, ServerClient } from '$lib/wire/Live.js';
import type { LiveError } from '$lib/wire/liveFailure.js';
import { INVALID_PARAMS, type ViewCall, ViewRefusal } from './ViewBridge.js';

export type FeedFailure = { readonly code: string; readonly reason: string; readonly unblock: readonly string[] };

type FeedRow<S> = { readonly id: string; readonly state: S; readonly standing: () => boolean; release: () => void };

export type FeedOpening<S, E> = {
  readonly open: (row: FeedRow<S>, fail: (failure: FeedFailure) => void) => Promise<(client: ServerClient) => Stream.Stream<E, LiveError>>;
  readonly seen?: (row: FeedRow<S>, event: E) => void;
  readonly opened?: (row: FeedRow<S>) => void;
  readonly released?: (row: FeedRow<S>) => void;
};

export class ViewFeeds<S> {
  private readonly mounts = new WeakMap<AbortSignal, Map<string, FeedRow<S>>>();

  constructor(
    private readonly live: LiveConnection,
    private readonly notification: string,
    private readonly noun: string,
  ) {}

  owned(call: ViewCall, id: string): FeedRow<S> {
    const row = this.rows(call.mounted).get(id);
    if (row === undefined) throw new ViewRefusal(INVALID_PARAMS, `unknown ${this.noun} subscription`);
    return row;
  }

  async subscribe<E extends object>(call: ViewCall, state: S, opening: FeedOpening<S, E>): Promise<{ subscription: string }> {
    const held = this.rows(call.mounted);
    const id = crypto.randomUUID();
    let feed: { unsubscribe: () => void } | null = null;
    let completed = false;
    let opened = false;
    let openingError: Error | null = null;
    let offStatus = () => {};
    const row: FeedRow<S> = {
      id,
      state,
      standing: () => held.has(id),
      release: () => {
        held.delete(id);
        feed?.unsubscribe();
        opening.released?.(row);
        offStatus();
        call.signal.removeEventListener('abort', row.release);
      },
    };
    held.set(id, row);
    call.signal.addEventListener('abort', row.release, { once: true });
    const fail = (failure: FeedFailure) => {
      if (!held.has(id)) return;
      if (opened) call.notify(this.notification, { subscription: id, failure });
      else openingError = new Error(failure.reason);
      row.release();
    };
    try {
      const open = await opening.open(row, fail);
      feed = this.live.hold<E | null>(
        (client) => open(client).pipe(Stream.concat(Stream.succeed(null))),
        (event) => {
          if (!held.has(id)) return;
          if (event !== null) opening.seen?.(row, event);
          call.notify(this.notification, { subscription: id, event });
          if (event === null) {
            completed = true;
            row.release();
          }
        },
        (failure) =>
          fail({
            code: String(failure.code ?? failure.kind),
            reason: failure.message,
            unblock: failure.kind === 'subscription' ? (failure.unblock ?? []) : [],
          }),
        'feed',
        'once',
      );
      offStatus = this.live.subscribeStatus((status) => {
        if (status === 'paused' || status === 'refused' || status === 'closed') {
          fail({
            code: `${this.noun}-interrupted`,
            reason: `the live connection is ${status}`,
            unblock: [`Start the ${this.noun} subscription again.`],
          });
        }
      });
      if (!held.has(id)) {
        feed.unsubscribe();
        offStatus();
        if (!completed) throw new Error(`the ${this.noun} subscription ended before opening`);
      } else opening.opened?.(row);
      opened = true;
      call.signal.removeEventListener('abort', row.release);
      return { subscription: id };
    } catch (failure) {
      row.release();
      throw openingError ?? failure;
    }
  }

  private rows(mounted: AbortSignal): Map<string, FeedRow<S>> {
    const standing = this.mounts.get(mounted);
    if (standing !== undefined) return standing;
    const rows = new Map<string, FeedRow<S>>();
    this.mounts.set(mounted, rows);
    mounted.addEventListener(
      'abort',
      () => {
        for (const row of rows.values()) row.release();
        rows.clear();
      },
      { once: true },
    );
    return rows;
  }
}
