import { expect } from 'bun:test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Git, gitLayer } from '@runlith/git/Git';
import { Effect, FileSystem, Layer, Tracer } from 'effect';
import { ProgramRoad } from '../executions/contract/service/programs.js';
import { localRoad } from '../executions/testing/road.js';
import { Configs } from './contract/service/configs.js';
import { configsLayer } from './layer.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const base = Layer.mergeAll(BunFileSystem.layer, gitLayer.pipe(Layer.provide(host)), Layer.succeed(ProgramRoad, localRoad([])));
const world = configsLayer.pipe(Layer.provideMerge(base));

const committed = Effect.fnUntraced(function* (files: Readonly<Record<string, string>>) {
  const disk = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const root = yield* disk.realPath(yield* disk.makeTempDirectoryScoped({ prefix: 'config-' }));
  const run = (args: readonly string[]) => git.run(args, { cwd: root });
  yield* run(['init', '-q']);
  const land = Effect.fnUntraced(function* (changed: Readonly<Record<string, string>>) {
    for (const [path, text] of Object.entries(changed)) {
      yield* disk.makeDirectory(`${root}/${path.split('/').slice(0, -1).join('/')}`, { recursive: true });
      yield* disk.writeFileString(`${root}/${path}`, text);
    }
    yield* run(['add', '-A']);
    yield* run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'version']);
  });
  yield* land(files);
  return { root, land };
});

const reading = (root: string) =>
  Effect.flatMap(Configs, (configs) => configs.read({ projectId: 1, actor: { _tag: 'Operator' }, root, tree: 'HEAD' }));

const evaluations = () => {
  const names: string[] = [];
  const tracer = Tracer.make({
    span: (options) => {
      names.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  return { tracer, count: () => names.filter((name) => name === 'Configs.evaluate').length };
};

layer(world, { excludeTestServices: true })('the config of a judged version', (it) => {
  it.effect(
    'a chain of relative imports yields Config in one process, the same content runs none, and an edit of an import runs it again',
    () =>
      Effect.gen(function* () {
        const { root, land } = yield* committed({
          'checks/shared.ts': `import { names } from './names';\nexport const refused = names;\n`,
          'checks/names.ts': `export const names = ['react'];\n`,
          'tagma.config.ts': [
            `import { defineConfig, Derive, Format, Loading } from '@runlith/tagma/rules';`,
            `import { refused } from './checks/shared';`,
            `export default defineConfig({`,
            `  inspections: { 'domain-no-ui': Loading.forbid({ from: ['packages/domain'], refuses: refused }) },`,
            `  format: { oxfmt: Format.command({ run: ['oxfmt'], files: ['**/*.ts'] }) },`,
            `  derive: {`,
            `    lock: Derive.command({ paths: ['bun.lock'], run: ['bun', 'install'] }),`,
            `    docs: Derive.command({ paths: ['site/dist/**', 'site/*.generated.ts'], run: ['bun', 'run', 'build'] }),`,
            `  },`,
            `});`,
          ].join('\n'),
        });
        const spans = evaluations();
        const first = yield* reading(root).pipe(Effect.withTracer(spans.tracer));
        expect(first?.inspections.get('domain-no-ui')).toMatchObject({
          builtin: 'loads',
          params: { base: '', from: ['packages/domain'], refuses: ['react'] },
        });
        expect(first?.format).toEqual([
          { key: 'oxfmt', command: { run: ['oxfmt'], files: ['**/*.ts'], ok: [0], reads: 'tree', on: 'commit' } },
        ]);
        expect(first?.derive).toEqual([
          { key: 'lock', command: { paths: ['bun.lock'], run: ['bun', 'install'] } },
          { key: 'docs', command: { paths: ['site/dist/**', 'site/*.generated.ts'], run: ['bun', 'run', 'build'] } },
        ]);
        expect(spans.count()).toBe(1);
        yield* reading(root).pipe(Effect.withTracer(spans.tracer));
        expect(spans.count()).toBe(1);
        yield* land({ 'checks/names.ts': `export const names = ['vue'];\n` });
        const edited = yield* reading(root).pipe(Effect.withTracer(spans.tracer));
        expect(spans.count()).toBe(2);
        expect(edited?.inspections.get('domain-no-ui')).toMatchObject({ params: { refuses: ['vue'] } });
      }),
  );

  it.effect('the network, the clock, randomness, the environment, the file system and packages refuse config-invalid at their place', () =>
    Effect.gen(function* () {
      const { root, land } = yield* committed({});
      const reached = {
        fetch: `const page = fetch('https://example.com');`,
        clock: `const now = Date.now();`,
        random: `const roll = Math.random();`,
        environment: `const home = process.env.HOME;`,
        files: `import { readFileSync } from 'node:fs';\nconst hosts = readFileSync('/etc/hosts', 'utf8');`,
        packages: `const ts = require('typescript');`,
        formatted: `const today = new Intl.DateTimeFormat('en').format();`,
        temporal: `const instant = Temporal.Now.instant();`,
      };
      for (const reach of Object.values(reached)) {
        yield* land({
          'tagma.config.ts': `import { defineConfig } from '@runlith/tagma/rules';\n\n${reach}\nexport default defineConfig({});\n`,
        });
        const refused = yield* Effect.flip(reading(root));
        expect(refused).toMatchObject({ code: 'config-invalid' });
        expect(refused.message).toStartWith('config-invalid: tagma.config.ts:3:');
      }
    }),
  );

  it.effect('a declaration that is no data or does not decode refuses config-invalid at the file and line declaring it', () =>
    Effect.gen(function* () {
      const { root, land } = yield* committed({
        'tagma.config.ts': `import { defineConfig, Format } from '@runlith/tagma/rules';\n\nexport default defineConfig({\n  format: { fmt: Format.command },\n});\n`,
      });
      expect((yield* Effect.flip(reading(root))).message).toStartWith('config-invalid: tagma.config.ts:4:');
      yield* land({
        'checks/declared.ts': `export const declared = {\n  format: {\n    fmt: { run: [], files: ['**'] },\n  },\n};\n`,
        'tagma.config.ts': `import { declared } from './checks/declared';\nexport default declared;\n`,
      });
      expect((yield* Effect.flip(reading(root))).message).toStartWith('config-invalid: checks/declared.ts:3:');
      yield* land({
        'checks/declared.ts': `export const declared = {\n  derive: {\n    lock: { paths: ['../bun.lock'], run: ['bun', 'install'] },\n  },\n};\n`,
      });
      expect((yield* Effect.flip(reading(root))).message).toStartWith('config-invalid: checks/declared.ts:3:');
    }),
  );
});
