import { expect, test } from 'bun:test';
import { detect } from './sectionText.js';

const section = (body: string) =>
  `import type { Section } from '../../protocol/section.js';\n\nexport const probe: Section = (ctx) => \`${body}\`;\n`;

test('a terminal verb and a bare operation id in a section are refused by file, line and term', () => {
  expect(detect('src/doctrine/sections/probe.ts', section('Read it with tagma read.\n'))).toEqual([
    {
      path: 'src/doctrine/sections/probe.ts',
      line: 3,
      term: 'tagma read',
      instead: "the operation's id through ctx.op, or `tagma op <id>`",
    },
  ]);
  expect(detect('probe.ts', section('First line\nRead it with read_zone.\n')).map((found) => [found.line, found.term])).toEqual([
    [4, 'read_zone'],
  ]);
});

test('the sanctioned spellings are silent, and so is everything outside a section', () => {
  for (const body of [
    "Read it with ${ctx.op('read_zone')}.\n",
    'A terminal calls `tagma op <id> <input>`.\n',
    'A task goes open → in_work → done.\n',
    'The comments law is ${ctx.commentsLaw}.\n',
  ]) {
    expect(detect('probe.ts', section(body)), body).toEqual([]);
  }
  expect(detect('other.ts', "// tagma read\nconst help = 'tagma read';\nconst text = `tagma read`;\n")).toEqual([]);
});

test('a section is read by its words alone, and a finding lands on the line that carries it', () => {
  const module = [
    '// A comment mentioning tagma read and read_zone.',
    "import { help } from './tagma read/read_zone.js';",
    'export const probe: Section = (ctx) => `First line',
    "Named ${ctx.op('read_block')} and read_zone.",
    '`;',
  ].join('\n');
  expect(detect('probe.ts', module).map((found) => [found.line, found.term])).toEqual([[4, 'read_zone']]);
});

test('a double brace is a hole nothing fills, and is refused with the interpolation to write', () => {
  const found = detect('probe.ts', section('Aims at {{ aim }} characters.\n'));
  expect(found.map((one) => [one.line, one.term])).toEqual([[3, '{{ aim }}']]);
  expect(found[0]?.instead).toContain('${ctx.');
});
