import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { ByteSize, Effect, FileSystem, Option, Path, PlatformError } from 'effect';
import { ExecutionId, type Incarnation } from '@runlith/executions/protocol/execution';
import { makeGenerationEviction } from './GenerationEviction';
import { makeGenerationReadLeases } from './GenerationReadLeases';
import { ExecutionStore } from './store/ExecutionStore';
import { unreadStore } from './testing/store';

const RETIRED: Incarnation = 1;
const FILE_BYTES = 100;
const info = (type: 'File' | 'Directory'): FileSystem.File.Info => ({
  type,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0o600,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: ByteSize.bytes(type === 'File' ? FILE_BYTES : 0),
  blksize: Option.none(),
  blocks: Option.none(),
});

type EvictionCase = { readonly executions: ReadonlyArray<ExecutionId>; readonly reserve: number; readonly unreadable?: boolean };
type PageRead = { readonly limit: number; readonly rows: number; readonly began: boolean };

const fixture = Effect.fnUntraced(function* ({ executions, reserve, unreadable = false }: EvictionCase) {
  const pages: PageRead[] = [];
  const removed: ExecutionId[] = [];
  let began = false;
  let evicted = false;
  const store = ExecutionStore.of({
    ...unreadStore,
    retiredLedger: () => Effect.succeed([]),
    oldestGeneration: () => Effect.succeed(evicted ? undefined : { incarnation: RETIRED, evicting: began }),
    generationExecutions: (_incarnation, after, limit) =>
      Effect.sync(() => {
        const from = after ?? 0;
        const slice = executions.slice(from, from + limit);
        pages.push({ limit, rows: slice.length, began });
        return { executions: slice, next: slice.length === limit ? from + limit : undefined };
      }),
    beginEviction: () =>
      Effect.sync(() => {
        began = true;
      }),
    evictGeneration: () =>
      Effect.sync(() => {
        evicted = true;
      }),
    setGenerationBytes: () => Effect.void,
  });
  const fs = FileSystem.makeNoop({
    stat: (at) =>
      unreadable && at.endsWith('.seg')
        ? PlatformError.systemError({ _tag: 'PermissionDenied', module: 'FileSystem', method: 'stat', pathOrDescriptor: at })
        : Effect.succeed(info(at.endsWith('.seg') ? 'File' : 'Directory')),
    readDirectory: () => Effect.succeed(['0.seg']),
  });
  const eviction = yield* makeGenerationEviction({
    records: '/records',
    currentIncarnation: 2,
    readVolume: Effect.succeed({ reserve, available: reserve * 10 }),
    removeRetained: (_incarnation, execution) =>
      Effect.sync(() => {
        removed.push(execution);
      }),
    leases: makeGenerationReadLeases(),
    availableMemory: Effect.succeed(0),
  }).pipe(Effect.provideService(ExecutionStore, store), Effect.provideService(FileSystem.FileSystem, fs), Effect.provide(Path.layer));
  yield* eviction.reclaimListed([{ incarnation: RETIRED, evicting: false, bytes: null, uncertain: true }]);
  return { pages, removed, evicted };
});
const ids = (count: number) => Array.from({ length: count }, (_, index) => ExecutionId.make(`exec-${index}`));

describe('a retired generation of unknown size', () => {
  it.effect('stops measuring at the cap, then removes every execution once after durable intent, even with only one row of memory', () =>
    Effect.gen(function* () {
      const executions = ids(5);
      const outcome = yield* fixture({ executions, reserve: 2_500 });
      expect(outcome.evicted).toBe(true);
      expect([...outcome.removed].sort()).toEqual([...executions].sort());
      expect(outcome.pages.every((page) => page.limit === 1)).toBe(true);
      const rows = (began: boolean) => outcome.pages.filter((page) => page.began === began).reduce((sum, page) => sum + page.rows, 0);
      expect(rows(false)).toBeLessThan(executions.length);
      expect(rows(true)).toBe(executions.length);
    }),
  );
  it.effect('keeps an unreadable generation rather than counting its partial bytes for the volume rule', () =>
    Effect.gen(function* () {
      const outcome = yield* fixture({ executions: ids(1), reserve: 100, unreadable: true });
      expect(outcome.evicted).toBe(false);
      expect(outcome.removed).toEqual([]);
      expect(outcome.pages.some((page) => !page.began)).toBe(true);
    }),
  );
});
