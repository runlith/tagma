import { Effect, Stream } from 'effect';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { StorageLayout } from '../storage/layout.js';
import type { CopyAim, ServedPlace } from '../contract/service/serving.js';

const KEPT = 512;

export type Placed = ServedPlace & { readonly layout: StorageLayout; readonly detachedAt: string | null };

type Followed = { readonly root: string; watching: boolean; epoch: number; stop: () => void };

const keyOf = (aim: CopyAim): string => `${aim.projectId}\u0000${aim.cwd ?? ''}\u0000${aim.branch ?? ''}`;

export const makePlaces = (input: {
  readonly rows: CheckoutRows['Service'];
  readonly fork: (effect: Effect.Effect<void>) => () => void;
}) => {
  const known = new Map<string, Placed>();
  const followed = new Map<number, Followed>();

  const forget = (projectId: number): void => {
    const following = followed.get(projectId);
    if (following !== undefined) following.epoch += 1;
    for (const [key, placed] of known) if (placed.row.id === projectId) known.delete(key);
  };

  const follow = (projectId: number, root: string): Followed => {
    const standing = followed.get(projectId);
    if (standing !== undefined && standing.root === root) return standing;
    standing?.stop();
    const following: Followed = {
      root,
      watching: false,
      epoch: 0,
      stop: () => undefined,
    };
    followed.set(projectId, following);
    following.stop = input.fork(
      Stream.runForEach(input.rows.checkoutsMoved(root), (moved) =>
        Effect.sync(() => {
          following.watching = moved.watching;
          forget(projectId);
        }),
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            following.watching = false;
            if (followed.get(projectId) === following) followed.delete(projectId);
          }),
        ),
      ),
    );
    return following;
  };

  return {
    known: (aim: CopyAim): Placed | undefined => {
      const key = keyOf(aim);
      const placed = known.get(key);
      if (placed === undefined || followed.get(aim.projectId)?.watching !== true) return undefined;
      known.delete(key);
      known.set(key, placed);
      return placed;
    },
    epoch: (projectId: number): number => followed.get(projectId)?.epoch ?? 0,
    remember: (aim: CopyAim, placed: Placed, epoch: number): void => {
      const following = follow(placed.row.id, placed.row.rootPath);
      if (!following.watching || following.epoch !== epoch) return;
      known.set(keyOf(aim), placed);
      for (const oldest of known.keys()) {
        if (known.size <= KEPT) break;
        known.delete(oldest);
      }
    },
    forget,
    forgetAll: (): void => {
      for (const following of followed.values()) following.epoch += 1;
      known.clear();
    },
    leave: (projectId: number): void => {
      forget(projectId);
      followed.get(projectId)?.stop();
      followed.delete(projectId);
    },
    close: (): void => {
      for (const following of followed.values()) following.stop();
      followed.clear();
      known.clear();
    },
  };
};

export type Places = ReturnType<typeof makePlaces>;
