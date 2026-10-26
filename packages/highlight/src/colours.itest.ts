import { describe, expect, test } from 'bun:test';
import { highlightLines, type CodeToken } from './colours';

const SAMPLE = 'function greet(name: string) {\n  const shout = "hi " + name;\n  return shout;\n}';

function colourOf(tokens: readonly CodeToken[] | undefined, text: string): string | undefined {
  return tokens?.find((token) => token.text === text)?.color;
}

describe('the per-line token answer', () => {
  test('colours a keyword, a declared name and a string with the stylesheet variables of their roles', async () => {
    const declaration = (await highlightLines(SAMPLE, 'typescript')).get(1);

    expect(['const', 'shout', '"hi "'].map((text) => colourOf(declaration, text))).toEqual([
      'var(--syntax-keyword)',
      'var(--syntax-declaration)',
      'var(--syntax-string)',
    ]);
  });

  test('carries every coloured line back whole, under the index that line has in the code', async () => {
    const coloured = await highlightLines(SAMPLE, 'typescript');

    expect([...coloured.keys()]).toEqual([0, 1, 2, 3]);
    expect([...coloured.values()].map((tokens) => tokens.map((token) => token.text).join(''))).toEqual(SAMPLE.split('\n'));
  });

  test('colours nothing for a language the bundle does not carry', async () => {
    expect(await highlightLines('alpha\nbeta', 'brainfuck')).toEqual(new Map());
  });
});

async function firstAndSecondAnswer(call: 'highlightCode' | 'highlightLines'): Promise<{ first: unknown; second: unknown }> {
  const owner = JSON.stringify(`${import.meta.dir}/colours.ts`);
  const sample = JSON.stringify(SAMPLE);
  const spawned = Bun.spawn(
    [
      'bun',
      '-e',
      `const owner = await import(${owner});
       const shape = (answer) => (answer instanceof Map ? [...answer] : answer);
       const first = await owner.${call}(${sample}, 'typescript');
       const second = await owner.${call}(${sample}, 'typescript');
       console.log(JSON.stringify({ first: shape(first), second: shape(second) }));`,
    ],
    { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, error] = await Promise.all([new Response(spawned.stdout).text(), new Response(spawned.stderr).text()]);
  if ((await spawned.exited) !== 0) throw new Error(error);
  return JSON.parse(out);
}

describe('a process answers its first block as it answers every later one', () => {
  test.each(['highlightCode', 'highlightLines'] as const)('holds for %s', async (call) => {
    const { first, second } = await firstAndSecondAnswer(call);

    expect(first).toEqual(second);
  });
});

describe('the bounds', () => {
  test('colours code of any length whole, carrying what one line opened into the lines past it', async () => {
    const lines = [
      'const before = 1;',
      '/* a comment opened here',
      ...Array.from({ length: 81 }, () => 'x'.repeat(399)),
      '*/',
      'const after = 2;',
    ];
    const coloured = await highlightLines(lines.join('\n'), 'typescript');

    expect([...coloured.keys()]).toEqual(lines.map((_, index) => index));
    const comment = coloured.get(1)?.[0]?.color;
    const keyword = colourOf(coloured.get(0), 'const');
    expect(comment).not.toBe(keyword);
    expect(new Set(coloured.get(lines.length - 3)?.map((token) => token.color))).toEqual(new Set([comment]));
    expect(colourOf(coloured.get(lines.length - 1), 'const')).toBe(keyword);
  });

  test('leaves one line too long to tokenize out of the answer while its neighbours keep their colours', async () => {
    const long = `"${'x'.repeat(500)}"`;
    const coloured = await highlightLines(`const a = 1;\nconst b = ${long};\nconst c = 2;`, 'typescript');

    expect([...coloured.keys()]).toEqual([0, 2]);
  });
});
