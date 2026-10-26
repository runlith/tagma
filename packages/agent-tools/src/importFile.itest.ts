import type { WorkspaceChange } from '@runlith/files/change';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { importFile, IMPORT_BASE_ABSENT, type ImportFailure } from './importFile';
import { ImportSourceRefused, type WorkspaceImports } from './WorkspaceImports';
import { contentDigest } from '@runlith/files/content';
import { landedOf, type WorkspaceChanges } from './WorkspaceChanges';
import { unruledTimes } from './CommandWork';
import { machineWorld } from './world/machine';
import { createTempDir, exists, host } from './testing/toolHarness';

function world(text: string | ImportSourceRefused) {
  const rows: WorkspaceChange[] = [];
  const spans: string[] = [];
  const imports: WorkspaceImports = {
    open: (namespace, path) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          spans.push('open');
          return text instanceof ImportSourceRefused
            ? Effect.fail(text)
            : Effect.succeed({ text, from: `${namespace.kind} ${namespace.id}:${path}` });
        }),
        () => Effect.sync(() => spans.push('release')),
      ),
  };
  const changes: WorkspaceChanges = {
    command: () => Effect.die('file imports open no command window'),
    land: <E, R>(batch: readonly WorkspaceChange[], write: Effect.Effect<boolean, E, R>) =>
      Effect.map(write, (written) => {
        for (const change of batch) {
          rows.push(change);
          spans.push(`wrote ${change.path}`);
        }
        return landedOf(written, written);
      }),
  };
  return { imports, changes, rows, spans };
}

const landed = (
  root: string,
  imports: WorkspaceImports,
  changes: WorkspaceChanges,
  request: { from: string; to: string; expect: string },
) =>
  importFile(
    {
      cwd: root,
      changes,
      world: machineWorld,
      commandTimes: unruledTimes,
      searchMs: 25_000,
    },
    imports,
    {
      source: { kind: 'sandbox', id: 'guest-1' },
      ...request,
    },
  );

const refusalOf = Effect.fnUntraced(function* (work: Effect.Effect<unknown, ImportFailure>) {
  const settled = yield* Effect.result(work);
  if (settled._tag === 'Success') return yield* Effect.die(new Error('The import was expected to refuse.'));
  return settled.failure;
});

it.effect('an import onto an absent destination creates it and records one write carrying both texts', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes, rows } = world('locked = 1\n');
    const answer = yield* landed(root, imports, changes, { from: 'bun.lock', to: 'bun.lock', expect: IMPORT_BASE_ABSENT });

    expect(yield* host.readFile(join(root, 'bun.lock'), 'utf8')).toBe('locked = 1\n');
    expect(answer.created).toBe(true);
    expect(answer.digest).toBe(contentDigest('locked = 1\n'));
    expect(answer.from).toBe('sandbox guest-1:bun.lock');
    expect(rows.map((row) => [row.origin, row.path, row.before, row.after])).toEqual([
      ['write', join(root, 'bun.lock'), contentDigest(''), contentDigest('locked = 1\n')],
    ]);
    expect(rows[0]?.hunk?.newText).toBe('locked = 1\n');
  }),
);

it.effect('the namespace is held until the bytes are down, and let go after', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes, spans } = world('generated\n');
    yield* landed(root, imports, changes, { from: 'out.ts', to: 'out.ts', expect: IMPORT_BASE_ABSENT });

    expect(spans).toEqual(['open', `wrote ${join(root, 'out.ts')}`, 'release']);
  }),
);

it.effect('a destination that moved since it was read refuses, naming what stands there, and changes nothing', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'bun.lock'), 'theirs\n', 'utf8');
    const { imports, changes, rows, spans } = world('mine\n');
    const failure = yield* refusalOf(
      landed(root, imports, changes, { from: 'bun.lock', to: 'bun.lock', expect: contentDigest('what I read\n') }),
    );

    expect(failure._tag).toBe('ImportRefused');
    expect(failure._tag === 'ImportRefused' ? failure.code : null).toBe('expected-base');
    expect(failure._tag === 'ImportRefused' ? failure.actual : null).toBe(contentDigest('theirs\n'));
    expect(yield* host.readFile(join(root, 'bun.lock'), 'utf8')).toBe('theirs\n');
    expect(rows).toEqual([]);
    expect(spans).toEqual([]);
  }),
);

it.effect('a destination that can be written but not read refuses rather than passing for absent', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const at = join(root, 'write-only.lock');
    yield* host.writeFile(at, 'theirs, unreadable\n', 'utf8');
    yield* host.chmod(at, 0o222);
    const { imports, changes, rows } = world('mine\n');
    const failure = yield* refusalOf(
      landed(root, imports, changes, { from: 'bun.lock', to: 'write-only.lock', expect: IMPORT_BASE_ABSENT }),
    );

    expect(failure._tag).toBe('PlatformError');
    expect(rows).toEqual([]);
    yield* host.chmod(at, 0o644);
    expect(yield* host.readFile(at, 'utf8')).toBe('theirs, unreadable\n');
  }),
);

it.effect('a namespace that refuses carries its own words out, and nothing is written', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes, rows } = world(
      new ImportSourceRefused({ code: 'sandbox-working', reason: 'guest-1 is bound to a thread taking a turn' }),
    );
    const failure = yield* refusalOf(landed(root, imports, changes, { from: 'bun.lock', to: 'bun.lock', expect: IMPORT_BASE_ABSENT }));

    expect(failure._tag).toBe('ImportSourceRefused');
    expect(failure.message).toContain('taking a turn');
    expect(rows).toEqual([]);
    expect(yield* exists(join(root, 'bun.lock'))).toBe(false);
  }),
);

it.effect('an import replacing a file the caller named by digest lands, and the answer is the next expected base', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    yield* host.writeFile(join(root, 'bun.lock'), 'first\n', 'utf8');
    const { imports, changes, rows } = world('second\n');
    const answer = yield* landed(root, imports, changes, { from: 'bun.lock', to: 'bun.lock', expect: contentDigest('first\n') });

    expect(answer.created).toBe(false);
    expect(answer.digest).toBe(contentDigest('second\n'));
    expect(rows[0]?.before).toBe(contentDigest('first\n'));
    expect(yield* host.readFile(join(root, 'bun.lock'), 'utf8')).toBe('second\n');
  }),
);

it.effect('under forbid the prose a workload wrote never lands', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes, rows } = world('// what this module is for\nexport const value = 1;\n');
    const answer = yield* importFile(
      {
        cwd: root,
        changes,
        comments: () => Effect.succeed('forbid' as const),
        world: machineWorld,
        commandTimes: unruledTimes,
        searchMs: 25_000,
      },
      imports,
      {
        source: { kind: 'sandbox', id: 'guest-1' },
        from: 'out.ts',
        to: 'out.ts',
        expect: IMPORT_BASE_ABSENT,
      },
    );

    expect(yield* host.readFile(join(root, 'out.ts'), 'utf8')).toBe('export const value = 1;\n');
    expect(answer.digest).toBe(contentDigest('export const value = 1;\n'));
    expect(answer.lines).toBe(2);
    expect(rows[0]?.after).toBe(contentDigest('export const value = 1;\n'));
  }),
);

it.effect('with no comment law declared the bytes land exactly as the workload wrote them', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes } = world('// what this module is for\nexport const value = 1;\n');
    const answer = yield* landed(root, imports, changes, { from: 'out.ts', to: 'out.ts', expect: IMPORT_BASE_ABSENT });

    expect(yield* host.readFile(join(root, 'out.ts'), 'utf8')).toBe('// what this module is for\nexport const value = 1;\n');
    expect(answer.comments).toBe('');
  }),
);

it.effect('a destination outside the workspace is refused by the same fence every file tool stands behind', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports, changes, rows } = world('mine\n');
    const failure = yield* refusalOf(
      importFile({ cwd: root, changes, world: machineWorld, commandTimes: unruledTimes, searchMs: 25_000 }, imports, {
        source: { kind: 'sandbox', id: 'guest-1' },
        from: 'bun.lock',
        to: '../escaped.lock',
        expect: IMPORT_BASE_ABSENT,
      }),
    );

    expect(failure._tag).toBe('WorkspaceRefused');
    expect(rows).toEqual([]);
  }),
);

it.effect('an import the binding could not record lands with recorded false', () =>
  Effect.gen(function* () {
    const root = yield* createTempDir();
    const { imports } = world('mine\n');
    const answer = yield* landed(
      root,
      imports,
      {
        command: () => Effect.die('file imports open no command window'),
        land: <E, R>(_batch: readonly WorkspaceChange[], write: Effect.Effect<boolean, E, R>) =>
          Effect.map(write, (written) => landedOf(written, false)),
      },
      { from: 'out.ts', to: 'out.ts', expect: IMPORT_BASE_ABSENT },
    );

    expect(answer.recorded).toBe(false);
    expect(yield* host.readFile(join(root, 'out.ts'), 'utf8')).toBe('mine\n');
  }),
);
