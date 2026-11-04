import { it } from '@runlith/effect-test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { Effect } from 'effect';
import { bundle } from './bundle';

const tree = realpathSync(mkdtempSync(join(tmpdir(), 'bundle-')));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const wrote = (path: string, text: string): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};

const starting = (name: string): string => `export const start = () => new Worker(new URL('./${name}', import.meta.url));\n`;

it.live('the closure carries every module its bundles start beside themselves, from the source that names it', () =>
  Effect.gen(function* () {
    const root = join(tree, 'carried');
    const entry = wrote(join(root, 'main.ts'), `import { start } from './lib/starter';\nstart();\n`);
    wrote(join(root, 'lib/starter.ts'), starting('job.worker.ts'));
    const job = wrote(join(root, 'lib/job.worker.ts'), `import { start } from './deep/starter';\nstart();\n`);
    wrote(join(root, 'lib/deep/starter.ts'), starting('deep.worker.ts'));
    const deep = wrote(join(root, 'lib/deep/deep.worker.ts'), 'postMessage(1);\n');

    const closure = yield* bundle(entry, 'main.js');

    expect(closure.map((one) => [one.name, one.source])).toEqual([
      ['main.js', entry],
      ['job.worker.ts', job],
      ['deep.worker.ts', deep],
    ]);
  }),
);

it.live(
  'a bundle with its map kept apart names no map, answers the map and every source it carries, and takes a defined name in place',
  () =>
    Effect.gen(function* () {
      const root = join(tree, 'apart');
      const entry = wrote(
        join(root, 'main.ts'),
        `import { said } from './said';\ndeclare const BUILT: string | undefined;\nconsole.log(said, typeof BUILT === 'string' ? BUILT : 'none');\n`,
      );
      const said = wrote(join(root, 'said.ts'), `export const said = 'hello';\n`);
      wrote(join(root, 'unused.ts'), `export const unused = 1;\n`);

      const [one] = yield* bundle(entry, 'main.js', { sourcemap: 'external', define: { BUILT: '"7"' } });

      expect(one!.text).not.toContain('sourceMappingURL');
      expect(one!.text).toContain('"7"');
      expect(JSON.parse(one!.map!).sources).toHaveLength(2);
      expect([...one!.inputs].sort()).toEqual([entry, said].sort());
    }),
);

it.live(
  'a bundle without comments drops its own kept comments and module banners, keeps the text its strings hold and a dependency its legal note',
  () =>
    Effect.gen(function* () {
      const root = join(tree, 'bare');
      const entry = wrote(
        join(root, 'main.ts'),
        `import { note } from 'dep';\n//! why the entry stands\nexport const told = \`a\n//! held by a string\n\` + note;\n`,
      );
      wrote(join(root, 'node_modules/dep/package.json'), JSON.stringify({ name: 'dep', main: 'index.js' }));
      wrote(join(root, 'node_modules/dep/index.js'), `/*! dep is licensed */\nexport const note = 'n';\n`);

      const [kept] = yield* bundle(entry, 'main.js');
      const [bare] = yield* bundle(entry, 'main.js', { comments: 'none' });

      expect(kept!.text).toContain('//! why the entry stands');
      expect(kept!.text).toMatch(/^\/\/ \S*\/bare\/main\.ts$/mu);
      expect(bare!.text).not.toContain('why the entry stands');
      expect(bare!.text).not.toContain('/bare/main.ts');
      expect(bare!.text).toContain('//! held by a string');
      expect(bare!.text).toContain('/*! dep is licensed */');
    }),
);

it.live('a source that starts a module outside its own directory refuses instead of shipping a path the bundles lack', () =>
  Effect.gen(function* () {
    const root = join(tree, 'nested');
    const entry = wrote(join(root, 'main.ts'), starting('jobs/job.worker.ts'));
    wrote(join(root, 'jobs/job.worker.ts'), 'postMessage(1);\n');

    const outcome = yield* Effect.result(bundle(entry, 'main.js'));

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag === 'Failure') expect(outcome.failure.detail).toContain('./jobs/job.worker.ts');
  }),
);

it.live('two sources that start different files under one name refuse instead of shipping either', () =>
  Effect.gen(function* () {
    const root = join(tree, 'collides');
    const entry = wrote(
      join(root, 'main.ts'),
      `import { start as a } from './a/starter';\nimport { start as b } from './b/starter';\na();\nb();\n`,
    );
    wrote(join(root, 'a/starter.ts'), starting('job.worker.ts'));
    wrote(join(root, 'a/job.worker.ts'), 'postMessage("a");\n');
    wrote(join(root, 'b/starter.ts'), starting('job.worker.ts'));
    wrote(join(root, 'b/job.worker.ts'), 'postMessage("b");\n');

    const outcome = yield* Effect.result(bundle(entry, 'main.js'));

    expect(outcome._tag).toBe('Failure');
    if (outcome._tag === 'Failure') expect(outcome.failure.entry).toBe(entry);
  }),
);
