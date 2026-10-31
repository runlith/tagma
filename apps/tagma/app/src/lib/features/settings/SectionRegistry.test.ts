import { makePoint } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { SettingSections, type SettingsSection } from '$lib/features/settings/section.js';

const section = (id: string, keys: readonly string[]): SettingsSection => ({
  id,
  group: 'agent',
  order: 1,
  icon: (() => undefined) as never,
  keys,
});

test('two sections holding one setting refuse, naming the setting', () => {
  const sections = makePoint(SettingSections, section('context', ['agent.toolOutputShare']));

  expect(() => sections.register('features/other', section('other', ['agent.toolOutputShare']))).toThrow('Setting "agent.toolOutputShare"');
  expect(sections.items.map(({ id }) => id)).toEqual(['context']);
});
