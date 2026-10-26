import { Effect, FileSystem, Schema } from 'effect';
import { headAt, storeHeadAt } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { GraphStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { MIRROR_IDENTITY, mirrorIdentitySchema, type MirrorIdentity } from '../contract/wire/storage.js';
import { meta } from '../store/tables.js';
import { treeBranch } from '../tree/batch.js';
import type { StorageLayout } from './layout.js';
import { SnapshotFailed } from '../../platform/contract/service/snapshots.js';
import { askOnce } from '../tree/oneShot.js';
import { eq } from 'drizzle-orm';

export type MirrorCopy = { readonly path: string; readonly identity: MirrorIdentity };
export type UnreadMirror = { readonly path: string; readonly reason: string };
export type MirrorInspection = { readonly copies: readonly MirrorCopy[]; readonly unread: readonly UnreadMirror[] };
export type MirrorRename = { readonly projectId: number; readonly from: string; readonly to: string };
export type IdentityRequest = { readonly baseline: string; readonly home?: string; readonly path?: string; readonly rename?: MirrorRename };

export const readMirrorIdentities = (request: IdentityRequest) =>
  askOnce<MirrorInspection, SnapshotFailed>(
    new URL('./identity.worker.ts', import.meta.url),
    request,
    (reason) => new SnapshotFailed({ path: request.path ?? request.home ?? '', reason }),
  );

const marking = writes('Mirrors.identify', [meta]);

export const renameMirrorBranch = Effect.fn('Mirrors.rename')(function* (rename: MirrorRename) {
  const store = yield* GraphStore;
  const row = yield* store.db.select().from(meta).where(eq(meta.key, MIRROR_IDENTITY)).get();
  if (row === undefined) return;
  const identity = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(mirrorIdentitySchema))(row.value);
  if (identity.projectId !== rename.projectId || identity.branch !== rename.from) return;
  const value = JSON.stringify({ ...identity, branch: rename.to });
  yield* store.transaction(marking, () => store.db.update(meta).set({ value }).where(eq(meta.key, MIRROR_IDENTITY)));
});

export const renameColdMirror = Effect.fn('Mirrors.renameCold')(function* (path: string, baseline: string, rename: MirrorRename) {
  const files = yield* FileSystem.FileSystem;
  if (!(yield* files.exists(path))) return;
  const inspected = yield* readMirrorIdentities({ path, baseline, rename });
  const failure = inspected.unread[0];
  if (failure !== undefined) return yield* new SnapshotFailed({ path, reason: failure.reason });
});

export const identifyMirror = Effect.fn('Mirrors.identify')(function* (input: {
  readonly projectId: number;
  readonly checkout: string;
  readonly layout: StorageLayout;
}) {
  const { projectId, checkout, layout } = input;
  const store = yield* GraphStore;
  const git = yield* Git;
  const root = layout.mode === 'stealth' ? layout.treeRoot : checkout;
  const branch = yield* treeBranch(root);
  if ('held' in branch && branch.held !== 'detached' && branch.held !== 'no-repository') return;
  const standing = 'held' in branch && branch.held === 'no-repository' ? null : yield* storeHeadAt(git, root);
  const head = standing === null ? null : (standing.head ?? (yield* headAt(git, root)));
  const identity: MirrorIdentity = {
    projectId,
    treeRoot: layout.treeRoot,
    checkout,
    mode: layout.mode,
    branch: head?.ref?.replace(/^refs\/heads\//u, '') ?? null,
    gitDir: standing?.store.commonDir ?? null,
  };
  const value = JSON.stringify(identity);
  yield* store.transaction(marking, () =>
    store.db.insert(meta).values({ key: MIRROR_IDENTITY, value }).onConflictDoUpdate({ target: meta.key, set: { value } }),
  );
});
