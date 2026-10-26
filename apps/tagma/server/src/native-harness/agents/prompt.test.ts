import { expect, test } from 'bun:test';
import { Result } from 'effect';
import { editedPrompt, promptDocument } from './prompt.js';
import { contributions, SECTIONS } from '../../threads/doctrine/registry.js';

test('a changed catalog renders its own section even when its source and placement match a cached catalog', () => {
  const catalog = (value: string) =>
    contributions([
      ...Object.values(SECTIONS),
      { id: 'module-section', owner: 'module', path: 'src/module/section.ts', place: { prompt: 30 }, render: () => value },
    ]);
  const input = { agentId: 'reader', identity: 'Reader', sections: new Set(['module-section']) };
  const first = promptDocument({ ...input, render: { contributed: catalog('first') } });
  const second = promptDocument({ ...input, render: { contributed: catalog('second') } });
  expect(first.sections.find((section) => section.id === 'module-section')?.text).toBe('first');
  expect(second.sections.find((section) => section.id === 'module-section')?.text).toBe('second');
});

test('a base contribution is included without its capability being selected', () => {
  const catalog = contributions([
    ...Object.values(SECTIONS),
    { id: 'required-section', owner: 'module', path: 'src/module/required.ts', place: { prompt: 30, base: 70 }, render: () => 'required' },
  ]);
  const document = promptDocument({ agentId: 'reader', identity: 'Reader', sections: new Set(), render: { contributed: catalog } });
  expect(document.sections.map((section) => section.id)).toEqual([
    'preamble',
    'writing',
    'required-section',
    'refusals',
    'answering',
    'deciding',
    'holding-a-position',
  ]);
});

const document = {
  text: '',
  sections: [
    { id: 'first', title: 'First', source: 'src/first.ts', text: '## First\n\nOne and one.' },
    { id: 'second', title: 'Second', source: 'src/second.ts', text: '## Second\n\nTwo.' },
  ],
};

test('section edits apply in order, each to the document the previous one left', () => {
  const edited = editedPrompt(
    document,
    [
      { replace: 'second', text: '## Second\n\nReplaced.\n' },
      { add: 'zero', before: 'first', text: '## Zero' },
      { edit: 'second', find: 'Replaced.', with: 'Replaced, then edited.' },
    ],
    'variant',
  );
  if (Result.isFailure(edited)) throw edited.failure;
  expect(edited.success.sections.map((section) => [section.id, section.text])).toEqual([
    ['zero', '## Zero'],
    ['first', '## First\n\nOne and one.'],
    ['second', '## Second\n\nReplaced, then edited.'],
  ]);
  expect(edited.success.text).toBe(edited.success.sections.map((section) => section.text).join('\n\n'));
});

test('an edit whose section, passage or new id does not fit the document refuses', () => {
  for (const edit of [
    { drop: 'missing' },
    { add: 'third', after: 'missing', text: 'Three.' },
    { add: 'first', after: 'second', text: 'Again.' },
    { edit: 'first', find: 'Absent.', with: 'Present.' },
    { edit: 'first', find: 'ne', with: 'two' },
  ]) {
    const edited = editedPrompt(document, [edit], 'variant');
    expect(Result.isFailure(edited) ? edited.failure.code : edit).toBe('agent-invalid');
  }
  const overlapping = editedPrompt(
    { text: 'aaaa', sections: [{ id: 'run', title: 'run', source: 'src/run.ts', text: 'aaaa' }] },
    [{ edit: 'run', find: 'aaa', with: 'b' }],
    'variant',
  );
  expect(Result.isFailure(overlapping)).toBe(true);
});
