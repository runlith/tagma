import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createTools } from './index';
import { answer, options, recorder } from './testing/toolHarness';
import { memoryFixture } from './testing/memory';
import type { Tool } from '@runlith/agent/tool';

const patched = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const answered = yield* answer(tool, input);
  return {
    value: String(answered.value),
    patch: answered.display?.form === 'diff' ? answered.display.files[0].patch : '',
  };
});

const forbid = () => Effect.succeed('forbid' as const);

it.effect('an added prose comment does not land, a standing one does, and the record and patch carry what landed', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    const lines = Array.from({ length: 20 }, (_, index) => `const v${index} = ${index};`);
    lines[2] = '// a why that was already standing here';
    lines[11] = 'const a = 1;';
    yield* files.writeFileString(join(dir, 'alpha.ts'), `${lines.join('\n')}\n`);
    const sink = recorder();
    const tools = createTools(options({ cwd: dir, world, changes: sink.port, comments: forbid }));

    const applied = yield* patched(tools.edit, {
      path: 'alpha.ts',
      oldString: 'const a = 1;',
      newString: 'const a = 2; // why',
    });

    const landed = String(yield* files.readFileString(join(dir, 'alpha.ts'))).split('\n');
    expect(landed[11]).toBe('const a = 2;');
    expect(landed[2]).toBe('// a why that was already standing here');
    expect(sink.changes[0]?.hunk?.newText).toBe('const a = 2;\n');
    expect(applied.patch).toContain('+const a = 2;');
    expect(applied.patch).not.toContain('// why');
  }),
);

it.effect('a standing why the change re-indents is an added line, and goes', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    yield* files.writeFileString(join(dir, 'alpha.ts'), '// why this constant is what it is\nconst a = 1;\n');
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));

    const applied = yield* patched(tools.edit, {
      path: 'alpha.ts',
      oldString: '// why this constant is what it is\nconst a = 1;',
      newString: 'export function held() {\n  // why this constant is what it is\n  const a = 1;\n  return a;\n}',
    });

    expect(applied.value).toContain('Dropped 1 prose comment line');
    expect(yield* files.readFileString(join(dir, 'alpha.ts'))).toBe('export function held() {\n  const a = 1;\n  return a;\n}\n');
  }),
);

it.effect('a change that only re-indents a standing why still writes that line, and the ban takes it', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    yield* files.writeFileString(join(dir, 'alpha.ts'), '// why this constant is what it is\nconst a = 1;\n');
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));

    const applied = yield* patched(tools.edit, {
      path: 'alpha.ts',
      oldString: '// why this constant is what it is\nconst a = 1;',
      newString: '  // why this constant is what it is\n  const a = 1;',
    });

    expect(applied.value).toContain('Dropped 1 prose comment line');
    expect(yield* files.readFileString(join(dir, 'alpha.ts'))).toBe('  const a = 1;\n');
  }),
);

it.effect('an edit cannot leave half an adjacent prose comment beside a directive', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    yield* files.writeFileString(
      join(dir, 'alpha.ts'),
      '// A reason begins here\n// and continues here\n// @vitest-environment jsdom\nconst a = 1;\n',
    );
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));

    const applied = yield* patched(tools.edit, {
      path: 'alpha.ts',
      oldString: '// and continues here',
      newString: '// and continues differently',
    });

    expect(applied.value).toContain('Dropped 2 prose comment lines');
    expect(yield* files.readFileString(join(dir, 'alpha.ts'))).toBe('// @vitest-environment jsdom\nconst a = 1;\n');
  }),
);

it.effect('a comment marked deliberate lands whole', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    yield* files.writeFileString(join(dir, 'alpha.ts'), 'const a = 1;\n');
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));

    yield* answer(tools.edit, {
      path: 'alpha.ts',
      oldString: 'const a = 1;',
      newString: 'const a = 1; //! the why that cannot be code',
    });
    expect(yield* files.readFileString(join(dir, 'alpha.ts'))).toBe('const a = 1; //! the why that cannot be code\n');
  }),
);

it.effect('a new file lands without the header comment its write carried', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    const header = Array.from({ length: 12 }, (_, index) => `// header line ${index + 1}`);
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));

    yield* answer(tools.write, {
      path: 'header.ts',
      content: `${header.join('\n')}\nexport const value = 1;\n`,
    });
    expect(yield* files.readFileString(join(dir, 'header.ts'))).toBe('export const value = 1;\n');
  }),
);

it.effect('a text the reader cannot lex lands as written', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    const tools = createTools(options({ cwd: dir, world, comments: forbid }));
    const content = 'const a = `unterminated; // why\n';

    yield* answer(tools.write, { path: 'broken.ts', content });
    expect(yield* files.readFileString(join(dir, 'broken.ts'))).toBe(content);
  }),
);

it.effect('under allowed, and under no policy at all, the comment the change carried lands untouched', () =>
  Effect.gen(function* () {
    const { root: dir, files, world } = yield* memoryFixture;
    yield* files.writeFileString(join(dir, 'alpha.ts'), 'const a = 1;\nconst b = 2;\n');
    const permitted = createTools(options({ cwd: dir, world, comments: () => Effect.succeed('allowed' as const) }));
    const silent = createTools(options({ cwd: dir, world }));

    yield* answer(permitted.edit, {
      path: 'alpha.ts',
      oldString: 'const a = 1;',
      newString: 'const a = 1; // why',
    });
    yield* answer(silent.edit, {
      path: 'alpha.ts',
      oldString: 'const b = 2;',
      newString: 'const b = 2; // also why',
    });

    expect(yield* files.readFileString(join(dir, 'alpha.ts'))).toBe('const a = 1; // why\nconst b = 2; // also why\n');
  }),
);
