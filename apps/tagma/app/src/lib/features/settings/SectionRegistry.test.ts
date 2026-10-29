import { expect, test } from 'vitest';
import type { SectionContribution, SettingsSection } from '$lib/features/settings/section.js';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';

const component = (() => undefined) as never;

const section = (id: string, order: number): SettingsSection => ({ id, group: 'agent', order, icon: component });
const contribution = (target: string, order: number): SectionContribution => ({ section: target, order, view: component });

test('a section is declared by one feature and others contribute into it in order', () => {
  const registry = new SectionRegistry({
    '../mcp/settings.ts': { sections: [section('mcp', 4)] },
    '../tagma-apps/settings.ts': { sections: [section('apps', 5)] },
    '../secrets/settings.ts': { contributions: [contribution('apps', 20)] },
    '../launchers/settings.ts': { contributions: [contribution('apps', 10)] },
  });
  expect(registry.sections.map(({ id }) => id)).toEqual(['mcp', 'apps']);
  expect(registry.contributionsTo('apps').map(({ order }) => order)).toEqual([10, 20]);
});

test('two features declaring one section id are refused with both names', () => {
  expect(
    () =>
      new SectionRegistry({
        '../tagma-apps/settings.ts': { sections: [section('apps', 5)] },
        '../secrets/settings.ts': { sections: [section('apps', 6)] },
      }),
  ).toThrow('../tagma-apps/settings.ts and again by ../secrets/settings.ts');
});

test('a contribution to a section nobody declares is refused with the contributor and the section', () => {
  expect(() => new SectionRegistry({ '../secrets/settings.ts': { contributions: [contribution('apps', 1)] } })).toThrow(
    '../secrets/settings.ts contributes to the settings section apps',
  );
});
