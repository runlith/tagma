import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { resolveRipgrepPath } from '@runlith/ripgrep';
import { Context, type Duration, Effect, FileSystem, Layer } from 'effect';
import { type Adapter, type Capability, type Engine, Engines, type Subject } from './adapter';
import { makeNavigation } from './navigation';
import type { Verdict } from './verdict';

const FILES: Readonly<Record<string, string>> = {
  'a.ts': 'export const decide = () => 1;\n// decide is the answer\n',
  'b.ts': "import { decide } from './a';\ndecide();\nconst other = { decide: 2 };\n",
  'c.ts': `${'x'.repeat(100)};decide();\n`,
  'd.svelte': '<script>decide(); decide()</script>\ndecide\n',
  'e.ts': "import { decide as choose } from './a';\nchoose();\n",
  'f.ts': "import { decide as choose } from './a';\nchoose();\n",
  'g.md': 'decide, then decide again\n',
  'h.json': '{ "decide": 1 }\n',
};

const CAPABILITY: Capability = { language: 'fake', extensions: ['.ts'], manifests: ['package.json'], asks: ['definition', 'uses'] };

const declared = (path: string, line: number, column: number, text: string) => ({ path, line, column, text });

const DECIDE: Subject = {
  id: 'decide',
  name: 'decide',
  line: 1,
  declarations: [declared('a.ts', 1, 14, 'export const decide = () => 1;')],
};
const CHOOSE: Subject = {
  id: 'choose',
  name: 'choose',
  line: 1,
  declarations: [declared('e.ts', 1, 20, "import { decide as choose } from './a';")],
};
const ALSO: Subject = { ...CHOOSE, id: 'also', declarations: [declared('f.ts', 1, 20, "import { decide as choose } from './a';")] };

const OTHER_CHOOSE: Verdict = { _tag: 'other', symbol: 'choose' };

const VERDICTS: Readonly<Record<string, Verdict>> = {
  'decide a.ts:1:14': { _tag: 'use', kind: 'declaration', within: null },
  'decide a.ts:2:4': { _tag: 'text' },
  'decide b.ts:1:10': { _tag: 'use', kind: 'import', within: null },
  'decide b.ts:2:1': { _tag: 'use', kind: 'call', within: 'run' },
  'decide b.ts:3:17': { _tag: 'other', symbol: 'other.decide' },
  'decide e.ts:1:10': { _tag: 'use', kind: 'alias', within: null },
  'choose e.ts:1:20': { _tag: 'use', kind: 'alias', within: null },
  'choose e.ts:2:1': { _tag: 'use', kind: 'call', within: null },
  'choose f.ts:1:20': OTHER_CHOOSE,
  'choose f.ts:2:1': OTHER_CHOOSE,
  'decide f.ts:1:10': { _tag: 'use', kind: 'alias', within: null },
  'also e.ts:1:20': OTHER_CHOOSE,
  'also e.ts:2:1': OTHER_CHOOSE,
  'also f.ts:1:20': { _tag: 'use', kind: 'alias', within: null },
  'also f.ts:2:1': { _tag: 'use', kind: 'call', within: null },
};

const adapter: Adapter = {
  locate: () => Effect.succeed({ subjects: [DECIDE], resolved: true }),
  judge: ({ subject, positions }) =>
    Effect.forEach(positions, ({ path, line, column }) => {
      const verdict = VERDICTS[`${subject} ${path}:${line}:${column}`];
      return verdict === undefined ? Effect.die(`no verdict for ${subject} ${path}:${line}:${column}`) : Effect.succeed(verdict);
    }).pipe(Effect.map((verdicts) => ({ verdicts, aliases: subject === 'decide' ? [CHOOSE, ALSO] : [], basis: [] }))),
};

const SERVING: Engine = {
  capability: CAPABILITY,
  snapshot: { revision: 'r1', changed: ['c.ts', 'package.json'], problems: [] },
  warming: false,
  adapter,
};

const platform = BunChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const navigating = Effect.fnUntraced(function* (engine: Engine, keep: Duration.Input, sources: Readonly<Record<string, string>> = FILES) {
  const files = yield* FileSystem.FileSystem;
  const root = yield* files.makeTempDirectoryScoped();
  for (const [path, text] of Object.entries(sources)) {
    yield* files.makeDirectory(`${root}/${path.split('/').slice(0, -1).join('/') || '.'}`, { recursive: true });
    yield* files.writeFileString(`${root}/${path}`, text);
  }
  const binary = Effect.succeed(yield* Effect.promise(() => resolveRipgrepPath()));
  const engines = Context.make(Engines, Engines.of({ lease: () => Effect.succeed(engine) }));
  const navigation = yield* makeNavigation({ binary, platform: process.platform, ceilingMs: 60_000, keep, held: 8 }).pipe(
    Effect.provideContext(engines),
  );
  return { navigation, root };
});

const uses = { ask: 'uses', target: { _tag: 'at', path: 'b.ts', line: 2, name: 'decide' } } as const;

const LIBRARY: Readonly<Record<string, string>> = {
  'a.svelte': "<script>import { Effect } from 'effect';\nEffect.fn();</script>\n",
  'local.ts': 'export const Effect = { gen: 1 };\n',
  'one.ts': "import { Effect } from 'effect';\nEffect.fn();\n",
  'two.ts': "import { Effect } from 'effect';\nEffect.fn();\n",
  'three.ts': "import * as Effect from 'effect/Effect';\nEffect.fn();\n",
  'dead/x.ts': 'Effect.fn();\n',
  'dead/package.json': '{}\n',
  'package.json': '{}\n',
};

const FN: Subject = {
  id: 'fn',
  name: 'fn',
  line: 1,
  declarations: [declared('node_modules/effect/Effect.ts', 1, 14, 'export const fn = 1;')],
};

const OWNERS: Readonly<Record<string, readonly Subject[]>> = {
  'p.ts': [{ ...FN, id: 'a', declarations: [declared('node_modules/pkg/a.ts', 1, 14, 'export const fn = 1;')] }],
  'q.ts': [{ ...FN, id: 'b', declarations: [declared('node_modules/pkg/b.ts', 1, 14, 'export const fn = 2;')] }],
};

const MEMBERLESS = ['local.ts', 'back.ts', 'bare.ts'];

const imported = (located: string[], unseen: readonly string[] = [], changed: readonly string[] = []): Engine => ({
  ...SERVING,
  snapshot: { revision: 'r1', changed: ['dead/package.json', 'package.json', ...changed], problems: [] },
  adapter: {
    locate: (spot) => {
      const owner = spot._tag === 'member' ? spot.owner.path : '';
      located.push(owner);
      if (unseen.includes(owner)) return Effect.succeed({ subjects: [], resolved: false });
      return Effect.succeed({ subjects: OWNERS[owner] ?? (MEMBERLESS.includes(owner) ? [] : [FN]), resolved: true });
    },
    judge: ({ positions }) =>
      Effect.succeed({
        verdicts: positions.map((at): Verdict =>
          at.path.startsWith('dead/') ? { _tag: 'unverified', reason: 'no-program' } : { _tag: 'use', kind: 'call', within: null },
        ),
        aliases: [],
        basis: [],
      }),
  },
});

layer(platform, { excludeTestServices: true })('navigation', (it) => {
  it.effect('a member of an owner imported from a library is found beside the owner declared in the repository', () =>
    Effect.gen(function* () {
      const located: string[] = [];
      const { navigation, root } = yield* navigating(imported(located), '1 minute', LIBRARY);
      const answer = yield* navigation.ask({
        root,
        question: { ask: 'uses', target: { _tag: 'member', owner: 'Effect', member: 'fn' } },
        limit: 10,
      });
      expect(located.toSorted()).toEqual(['local.ts', 'one.ts', 'three.ts']);
      expect(answer.subject?.name).toBe('fn');
      expect(
        answer.rows.map((row) =>
          row._tag === 'boundary'
            ? `${row.path} ${row.reason} ×${row.matches}`
            : `${row.path}:${row.line}:${row.column} ${row._tag === 'use' ? row.kind : row.reason}`,
        ),
      ).toEqual(['one.ts:2:8 call', 'three.ts:2:8 call', 'two.ts:2:8 call', 'a.svelte no-adapter ×1', 'dead/x.ts no-program ×1']);
    }),
  );

  it.effect(
    'an imported owner is asked in its files until one unchanged since the snapshot resolves it, and that one answers for the import with or without the member',
    () =>
      Effect.gen(function* () {
        const located: string[] = [];
        const imports = "import { Effect } from 'effect';\nEffect.fn();\n";
        const { navigation, root } = yield* navigating(imported(located, ['away.ts'], ['back.ts']), '1 minute', {
          'away.ts': imports,
          'back.ts': imports,
          'bare.ts': imports,
          'more.ts': imports,
        });
        const refusal = yield* Effect.flip(
          navigation.ask({ root, question: { ask: 'uses', target: { _tag: 'member', owner: 'Effect', member: 'fn' } }, limit: 10 }),
        );
        expect(located).toEqual(['away.ts', 'back.ts', 'bare.ts']);
        expect(refusal._tag).toBe('missing');
      }),
  );

  it.effect(
    'owners imported under one local name from different things are refused with their list, the same thing found twice is not',
    () =>
      Effect.gen(function* () {
        const { navigation, root } = yield* navigating(imported([]), '1 minute', {
          'p.ts': "import { A as Owner } from 'pkg';\nOwner.fn();\n",
          'q.ts': "import { B as Owner } from 'pkg';\nOwner.fn();\n",
          'r.ts': "import Owner = require('pkg');\nOwner.fn();\n",
          's.ts': "import { A as Owner } from 'pkg';\nOwner.fn();\n",
        });
        const refusal = yield* Effect.flip(
          navigation.ask({ root, question: { ask: 'uses', target: { _tag: 'member', owner: 'Owner', member: 'fn' } }, limit: 10 }),
        );
        expect(refusal).toMatchObject({ _tag: 'ambiguous' });
        expect(refusal._tag === 'ambiguous' ? refusal.candidates.map((one) => one.path).toSorted() : []).toEqual([
          'node_modules/effect/Effect.ts',
          'node_modules/pkg/a.ts',
          'node_modules/pkg/b.ts',
        ]);
      }),
  );

  it.effect('a changed manifest is stale only where a program reads files beside it', () =>
    Effect.gen(function* () {
      const { navigation, root } = yield* navigating(imported([]), '1 minute', LIBRARY);
      const answer = yield* navigation.ask({
        root,
        question: { ask: 'uses', target: { _tag: 'member', owner: 'Effect', member: 'fn' } },
        limit: 10,
      });
      expect(answer.engine.stale).toEqual(['package.json']);
    }),
  );

  it.effect(
    'uses answers each occurrence once: verified uses first, then the snapshot and language boundary, the rest and the files outside code summarized',
    () =>
      Effect.gen(function* () {
        const { navigation, root } = yield* navigating(SERVING, '1 minute');
        const first = yield* navigation.ask({ root, question: uses, limit: 3 });
        const rest = yield* navigation.page({ cursor: first.next ?? '', limit: 10 });
        expect(
          [...first.rows, ...rest.rows].map((row) =>
            row._tag === 'boundary'
              ? `${row.path} ${row.reason} ×${row.matches}`
              : `${row.path}:${row.line}:${row.column} ${row._tag === 'use' ? `${row.kind} ${row.via ?? '-'}` : row.reason}`,
          ),
        ).toEqual([
          'a.ts:1:14 declaration -',
          'b.ts:1:10 import -',
          'b.ts:2:1 call -',
          'e.ts:1:10 alias -',
          'e.ts:1:20 alias choose',
          'e.ts:2:1 call choose',
          'f.ts:1:10 alias -',
          'f.ts:1:20 alias choose',
          'f.ts:2:1 call choose',
          'c.ts:1:102 changed',
          'd.svelte no-adapter ×3',
        ]);
        expect(rest.rows.find((row) => row._tag === 'unverified' && row.path === 'c.ts')).toMatchObject({
          text: `${'x'.repeat(59)};decide();`,
        });
        expect([first.total, rest.next]).toEqual([11, null]);
        expect(first.summary).toEqual({
          others: { matches: 1, symbols: 1 },
          texts: { matches: 1, files: 1 },
          outside: { matches: 3, files: 2 },
          boundary: [
            { reason: 'no-adapter', matches: 3, files: 1 },
            { reason: 'changed', matches: 1, files: 1 },
          ],
          partial: false,
        });
        expect(first.engine).toEqual({ revision: 'r1', lag: 2, warming: false, stale: ['package.json'], problems: [] });
      }),
  );

  it.effect('kind filtering preserves actionable positions and file boundaries across pages even without a confirmed use', () =>
    Effect.gen(function* () {
      const { navigation, root } = yield* navigating(
        {
          ...SERVING,
          adapter: {
            locate: adapter.locate,
            judge: ({ positions }) =>
              Effect.succeed({
                verdicts: positions.map((at): Verdict =>
                  at.path === 'a.ts'
                    ? { _tag: 'use', kind: 'declaration', within: null }
                    : { _tag: 'unverified', reason: at.line === 3 ? 'unclear' : 'no-program' },
                ),
                aliases: [],
                basis: [],
              }),
          },
        },
        '1 minute',
        {
          'a.ts': FILES['a.ts']!.split('\n')[0]!,
          'b.ts': 'decide();\ndecide();\ndecide();\n',
          'd.svelte': FILES['d.svelte']!,
        },
      );
      const first = yield* navigation.ask({ root, question: { ...uses, kinds: ['call'] }, limit: 1 });
      const rest = yield* navigation.page({ cursor: first.next ?? '', limit: 2 });
      expect([...first.rows, ...rest.rows]).toMatchObject([
        { _tag: 'unverified', path: 'b.ts', line: 3, column: 1, text: 'decide();', reason: 'unclear' },
        { _tag: 'boundary', path: 'b.ts', reason: 'no-program', matches: 2 },
        { _tag: 'boundary', path: 'd.svelte', reason: 'no-adapter', matches: 3 },
      ]);
      expect([first.total, rest.total, rest.next]).toEqual([3, 3, null]);
      expect(first.summary.boundary).toEqual([
        { reason: 'no-adapter', matches: 3, files: 1 },
        { reason: 'no-program', matches: 2, files: 1 },
        { reason: 'unclear', matches: 1, files: 1 },
      ]);
      expect(rest.summary).toEqual(first.summary);
    }),
  );

  it.effect('a page of an answer past its keep refuses', () =>
    Effect.gen(function* () {
      const { navigation, root } = yield* navigating(SERVING, '0 millis');
      const first = yield* navigation.ask({ root, question: uses, limit: 1 });
      expect(yield* Effect.flip(navigation.page({ cursor: first.next ?? '', limit: 1 }))).toEqual({ _tag: 'expired' });
    }),
  );

  it.effect('a definition whose file changed after the snapshot answers unverified, not confirmed', () =>
    Effect.gen(function* () {
      const { navigation, root } = yield* navigating(
        { ...SERVING, snapshot: { revision: 'r1', changed: ['a.ts'], problems: [] } },
        '1 minute',
      );
      const answer = yield* navigation.ask({ root, question: { ...uses, ask: 'definition' }, limit: 5 });
      expect(answer.rows).toMatchObject([{ _tag: 'unverified', path: 'a.ts', line: 1, reason: 'changed' }]);
    }),
  );
});
