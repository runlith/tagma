import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import * as MemoryFileSystem from '@runlith/testbed/memory';
import { shippedHarnessAdaptersLayer } from '../testing/builtin.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { codexCodec } from '../vendors/codex/codec.js';
import { hookLedger } from './hookLedger.js';
import { hookFiles } from './hookInstall.js';
import { ownPlaces, type OwnPlace } from './targets.js';

class Home extends Context.Service<Home, { readonly repo: string; readonly store: string; readonly target: string }>()(
  'test/ledger/Home',
) {}

const home = Layer.effect(
  Home,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-ledger-' });
    const repo = join(root, 'repo');
    const codex = join(root, 'home');
    yield* files.makeDirectory(codex);
    const source = hookFiles((yield* HarnessAdapters).all()).find((file) => file.file === '.codex/hooks.json')!;
    const hooks: Record<string, Readonly<Record<string, unknown>>[]> = {};
    for (const entry of source.entries) {
      (hooks[entry.event] ??= []).push(source.codec.file.entry(entry.command, entry.timeout));
    }
    yield* files.makeDirectory(join(repo, '.codex'), { recursive: true });
    yield* files.writeFileString(join(repo, source.file), JSON.stringify({ hooks }));
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const previous = process.env.CODEX_HOME;
        process.env.CODEX_HOME = codex;
        return previous;
      }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CODEX_HOME;
          else process.env.CODEX_HOME = previous;
        }),
    );
    return { repo, store: join(codex, 'config.toml'), target: join(repo, '.codex', 'hooks.json') };
  }),
).pipe(Layer.provideMerge(MemoryFileSystem.layer), Layer.provideMerge(shippedHarnessAdaptersLayer));

const keyOf = (target: string, place: OwnPlace): string => {
  const descriptor = codexCodec.file.trust;
  if (descriptor === null) throw new Error('the codex codec declares no trust address');
  return descriptor.key(target, place.event, place.group, place.handler);
};

const ledgerText = (keys: readonly string[]): string =>
  ['[hooks.state]', ...keys.map((key) => `"${key}" = { trusted_hash = "sha256:0" }`), ''].join('\n');

layer(home, { excludeTestServices: true })('hook trust ledger', (it) => {
  it.effect('an occasion keyed at every place reads present, and one keyed at only some reads absent', () =>
    Effect.gen(function* () {
      const { repo, store, target } = yield* Home;
      const files = yield* FileSystem.FileSystem;
      const doc = JSON.parse(yield* files.readFileString(target));
      doc.hooks.SessionStart = [...(doc.hooks.SessionStart ?? []), { hooks: [{ type: 'command', command: 'tagma prime' }] }];
      yield* files.writeFileString(target, JSON.stringify(doc));
      const places = ownPlaces(doc, codexCodec.file.events);
      const starts = places.filter((place) => place.event === 'SessionStart');
      expect(starts.length).toBeGreaterThan(1);
      const unkeyed = starts[starts.length - 1];
      yield* files.writeFileString(store, ledgerText(places.filter((place) => place !== unkeyed).map((place) => keyOf(target, place))));
      const row = (yield* hookLedger(repo)).find((one) => one.target === target);
      expect(row?.state).toBe('read');
      if (row?.state === 'read') {
        expect(row.absent).toEqual(['SessionStart']);
        expect(row.present).toContain('Stop');
        expect(row.present).toContain('PermissionRequest');
        expect(row.path).toBe(store);
      }
    }),
  );

  it.effect('a store that is not there is an empty ledger, not an unreadable one', () =>
    Effect.gen(function* () {
      const { repo, store, target } = yield* Home;
      yield* (yield* FileSystem.FileSystem).remove(store, { force: true });
      const row = (yield* hookLedger(repo)).find((one) => one.target === target);
      expect(row?.state).toBe('read');
      if (row?.state === 'read') {
        expect(row.present).toEqual([]);
        expect(row.absent).toContain('SessionStart');
        expect(row.path).toBe(store);
      }
    }),
  );

  it.effect('a store that will not parse is not measured, and names the file it could not read', () =>
    Effect.gen(function* () {
      const { repo, store, target } = yield* Home;
      yield* (yield* FileSystem.FileSystem).writeFileString(store, '[hooks.state\n"half a key" =\n');
      const row = (yield* hookLedger(repo)).find((one) => one.target === target);
      expect(row?.state).toBe('unreadable');
      if (row?.state === 'unreadable') {
        expect(row.reason).toBe('not TOML');
        expect(row.path).toBe(store);
      }
    }),
  );

  it.effect('a format publishing no measured trust address reads unsupported, never present', () =>
    Effect.gen(function* () {
      const { repo } = yield* Home;
      const rows = yield* hookLedger(repo);
      for (const file of [join('.claude', 'settings.json'), join('.cursor', 'hooks.json')]) {
        const row = rows.find((one) => one.target.endsWith(file));
        expect(row?.state).toBe('unsupported');
      }
    }),
  );
});
