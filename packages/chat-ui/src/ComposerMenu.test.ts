import { describe, expect, test } from 'vitest';
import { Effect } from 'effect';
import { skillQuery } from '@runlith/agent/skillReferences';
import type { ComposerSlashCommand } from './composer';
import { ComposerMenu, type ComposerCatalogs } from './ComposerMenu.svelte';

const command = (spec: Omit<ComposerSlashCommand, 'run'>): ComposerSlashCommand => ({ ...spec, run: () => Effect.void });

const skills = [
  { id: 'artifacts', label: '$artifacts', description: 'Write a page.' },
  { id: 'ag-term', label: '$ag-term', description: 'Name owners.' },
];

const catalog: ComposerCatalogs = {
  commands: [
    command({ name: 'new' }),
    command({ name: 'compact', disabled: true }),
    command({
      name: 'mode',
      options: [
        { id: 'trust', label: 'Trust' },
        { id: 'bypass', label: 'Bypass', active: true },
      ],
    }),
    command({ name: 'hand', fields: [{ id: 'text', label: 'Text' }] }),
  ],
  providers: [
    { id: 'blocks', prefix: '@', options: () => [{ id: 'block', label: 'A block' }] },
    {
      id: 'skills',
      prefix: '$',
      match: (text, from, to) => skillQuery(text, from, to),
      options: (query) => skills.filter((skill) => skill.id.includes(query)),
    },
  ],
};

describe('composer completion state', () => {
  test('a skill pick owns only the token around the caret, not the sentence', () => {
    const menu = new ComposerMenu(() => catalog);
    const text = 'Before $artifacts after';
    menu.update({ text, from: 11, to: 11 });
    expect(menu.kind).toBe('mention');
    expect(menu.query).toBe('art');
    expect(menu.pick()).toEqual({ kind: 'mention', provider: 'skills', id: 'artifacts', from: 7, to: 17 });
    menu.update({ text, from: 7, to: 17 });
    expect(menu.kind).toBeNull();
  });

  test('dismissal survives a selection report until the text or caret changes', () => {
    const menu = new ComposerMenu(() => catalog);
    const position = { text: 'Before $ after', from: 8, to: 8 };
    menu.update(position);
    menu.back();
    menu.update(position);
    expect(menu.kind).toBeNull();
    menu.update({ text: 'Before $ar after', from: 10, to: 10 });
    expect(menu.pick()).toEqual({ kind: 'mention', provider: 'skills', id: 'artifacts', from: 7, to: 10 });
  });

  test('slash choices and forms preserve their own argument semantics', () => {
    const menu = new ComposerMenu(() => catalog);
    menu.update({ text: '/', from: 1, to: 1 });
    menu.move(1);
    expect(menu.options[menu.active]?.id).toBe('mode');
    expect(menu.pick()).toBeNull();
    expect(menu.pick()).toEqual({ kind: 'command', name: 'mode', optionId: 'bypass' });
    menu.back();
    menu.update({ text: '/hand', from: 5, to: 5 });
    expect(menu.pick()).toBeNull();
    expect(menu.form()).toBeNull();
    menu.values.text = 'Build the page.';
    expect(menu.form()).toMatchObject({ kind: 'form', values: { text: 'Build the page.' } });
  });

  test('options that arrive after a full command name was typed open preselected, unless the reader stepped back out', () => {
    let options: readonly { id: string; label: string; active?: boolean }[] | undefined;
    const menu = new ComposerMenu(() => ({ ...catalog, commands: [command({ name: 'compact', options })] }));
    menu.update({ text: '/compact', from: 8, to: 8 });
    expect(menu.section).toBeNull();
    options = [
      { id: 'default', label: 'Default', active: true },
      { id: 'other', label: 'Other' },
    ];
    menu.reconcile();
    expect(menu.pick()).toEqual({ kind: 'command', name: 'compact', optionId: 'default' });
    menu.back();
    menu.reconcile();
    expect(menu.section).toBeNull();
  });

  test('a slash query with a missed or wrong letter still offers the command it meant, first and picked', () => {
    const menu = new ComposerMenu(() => ({ ...catalog, commands: [...catalog.commands, command({ name: 'delegation' })] }));
    menu.update({ text: '/delg', from: 5, to: 5 });
    expect(menu.pick()).toEqual({ kind: 'command', name: 'delegation' });
    menu.update({ text: '/nwe', from: 4, to: 4 });
    expect(menu.options).toEqual([]);
    menu.update({ text: '/hnad', from: 5, to: 5 });
    expect(menu.options[0]?.id).toBe('hand');
  });

  test('slash is whole-draft while mentions remain attachment actions', () => {
    const menu = new ComposerMenu(() => catalog);
    menu.update({ text: 'Before /new', from: 11, to: 11 });
    expect(menu.kind).toBeNull();
    menu.update({ text: 'Before @blo after', from: 11, to: 11 });
    expect(menu.pick()).toEqual({ kind: 'mention', provider: 'blocks', id: 'block', from: 7, to: 11 });
    menu.update({ text: '`$artifacts`', from: 11, to: 11 });
    expect(menu.kind).toBeNull();
  });
});

describe('availability of an entered command', () => {
  test('a command that turns disabled leaves its section, refusing pick and submit', () => {
    let disabled = false;
    const menu = new ComposerMenu(() => ({
      providers: [],
      commands: [
        {
          name: 'hand',
          get disabled() {
            return disabled;
          },
          fields: [{ id: 'text', label: 'Text' }],
          run: () => Effect.void,
        },
      ],
    }));
    menu.update({ text: '/hand', from: 5, to: 5 });
    menu.pick();
    menu.values.text = 'Build the page.';
    expect(menu.form()).not.toBeNull();

    disabled = true;
    expect(menu.form()).toBeNull();
    menu.reconcile();
    expect(menu.section).toBeNull();
  });

  test('a command removed while its options are shown cannot be picked', () => {
    let commands: readonly ComposerSlashCommand[] = [command({ name: 'mode', options: [{ id: 'trust', label: 'Trust' }] })];
    const menu = new ComposerMenu(() => ({ providers: [], commands }));
    menu.update({ text: '/mode', from: 5, to: 5 });
    expect(menu.section).toBe('mode');

    commands = [];
    expect(menu.pick()).toBeNull();
  });
});
