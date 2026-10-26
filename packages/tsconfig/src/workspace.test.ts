import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, FileSystem } from 'effect';
import { findRoot, read } from './workspace.js';

const root = '/workspace';
const manifest = `${root}/package.json`;
const packageManifest = `${root}/packages/a/package.json`;

const files = (documents: ReadonlyMap<string, string>) =>
  FileSystem.makeNoop({
    exists: (path) => Effect.succeed(documents.has(path)),
    readFileString: (path) => {
      const text = documents.get(path);
      return text === undefined ? Effect.die(`unexpected read: ${path}`) : Effect.succeed(text);
    },
  });

it.effect('workspace readers return the manifest path in typed failures for malformed external fields', () =>
  Effect.gen(function* () {
    for (const text of ['null', '{"workspaces":[42]}', '{"workspaces":{"packages":null}}']) {
      const fileSystem = files(new Map([[manifest, text]]));
      for (const reading of [findRoot(root).pipe(Effect.asVoid), read(root).pipe(Effect.asVoid)]) {
        const failure = yield* Effect.flip(reading.pipe(Effect.provideService(FileSystem.FileSystem, fileSystem)));
        expect(failure).toMatchObject({ _tag: 'WorkspaceUnreadable', path: manifest });
      }
    }
    const failure = yield* Effect.flip(
      read(root).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          files(
            new Map([
              [manifest, JSON.stringify({ workspaces: ['packages/a'] })],
              [packageManifest, JSON.stringify({ name: 'a', dependencies: { b: 42 } })],
            ]),
          ),
        ),
      ),
    );
    expect(failure).toMatchObject({ _tag: 'WorkspaceUnreadable', path: packageManifest });
  }),
);

it.effect('a manifest keeps workspace patterns, package names and dependency specifications', () =>
  Effect.gen(function* () {
    const fileSystem = files(
      new Map([
        [manifest, JSON.stringify({ workspaces: { packages: ['packages/a'] }, private: true })],
        [packageManifest, JSON.stringify({ name: 'a', scripts: { typecheck: 'runlith-typecheck' }, dependencies: { b: 'workspace:*' } })],
      ]),
    );
    expect(yield* findRoot(root).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem))).toBe(root);
    expect(yield* read(root).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem))).toEqual([
      {
        name: 'a',
        dir: `${root}/packages/a`,
        kind: 'tsc',
        deps: [{ name: 'b', spec: 'workspace:*', onWorkspace: true }],
        config: { kind: 'absent', path: `${root}/packages/a/tsconfig.json` },
        pendingExtends: null,
      },
    ]);
  }),
);
