// @vitest-environment jsdom
import { QueryClient } from '@tanstack/query-core';
import { mountRepo } from '@runlith/query/testing';
import { Scope } from '@runlith/layer/Scope';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { testDoor } from '$lib/wire/testing.js';
import { loadOperations } from '$lib/wire/operation.js';
import { makePoint } from '@runlith/layer/testing';
import { SectionContributions, SettingSections, type SettingsSection } from './section.js';
import { SectionRegistry } from './SectionRegistry.js';
import { SettingsCatalog } from './SettingsCatalog.svelte.js';
import { SettingsRepo } from './SettingsRepo.js';

await loadOperations();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const CATALOG = {
  sections: [
    { id: 'agent', title: 'Agent', description: '' },
    { id: 'orientation', title: 'Orientation', description: '' },
    { id: 'telemetry', title: 'Telemetry', description: '' },
    { id: 'terminal', title: 'Terminal', description: '' },
  ],
  entries: [
    {
      id: 'agent.toolOutputShare',
      section: 'agent',
      title: 'Tool output share',
      description: '',
      shape: 'number',
      control: { kind: 'share', minimum: 0.01, maximum: 0.9 },
      scopes: ['user', 'project'],
      merge: 'replace',
      value: 0.27,
      from: 'project',
      fallback: 0.2,
      layers: {
        user: { value: 0.3, declined: false },
        project: { value: 0.27, declined: false, writer: { harness: 'tagma', key: '01a06ef7' } },
      },
    },
    {
      id: 'orientation.mapBudget',
      section: 'orientation',
      title: 'Map size',
      description: '',
      shape: 'integer',
      scopes: ['project'],
      merge: 'replace',
      value: 1250,
      from: 'project',
      fallback: 1200,
      layers: { project: { value: 1250, declined: false } },
    },
    {
      id: 'telemetry.maxBytes',
      section: 'telemetry',
      title: 'Trace storage',
      description: '',
      shape: 'integer',
      scopes: ['user'],
      merge: 'replace',
      value: 5368709120,
      from: 'default',
      fallback: 5368709120,
      layers: {},
    },
    {
      id: 'terminal.tabLayouts',
      section: 'terminal',
      title: 'Tab layouts',
      description: '',
      shape: '{ order: string[] }',
      control: { kind: 'machine' },
      scopes: ['user', 'project'],
      merge: 'replace',
      value: { order: ['a'] },
      from: 'user',
      fallback: { order: [] },
      layers: { user: { value: { order: ['a'] }, declined: false } },
    },
  ],
  rejections: [],
};

let answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const fetch = (input: RequestInfo | URL, init?: RequestInit) => answer(input, init);
beforeEach(() => {
  answer = async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.pathname === '/api/op/read_settings') return json({ status: 'ok', project: { id: 1, name: 'demo' }, settings: CATALOG });
    throw new Error(`Unexpected request ${url.pathname}`);
  };
});

const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of close.splice(0)) await release();
});

const registry = (...declared: readonly SettingsSection[]) =>
  new SectionRegistry(makePoint(SettingSections, ...declared), makePoint(SectionContributions));

async function read(sections = registry()): Promise<SettingsCatalog> {
  const queryClient = new QueryClient();
  const mounted = mountRepo(SettingsRepo, { door: testDoor(fetch), queryClient });
  const scope = Scope.make();
  close.push(async () => {
    await scope.close();
    await mounted.unmount();
  });
  const catalog = new SettingsCatalog(mounted.repo, sections, scope, { projectId: 1 });
  await waitUntil(() => catalog.entries.length === 3);
  return catalog;
}

test('a layer answers with its own value, what it would inherit, and what stands in front of it', async () => {
  const catalog = await read();
  const share = catalog.entries[0]!;

  expect(catalog.answerOf(share, 'project')).toMatchObject({
    own: 0.27,
    inherited: 0.3,
    inheritedFrom: 'user',
    writer: { harness: 'tagma', key: '01a06ef7' },
  });
  expect(catalog.answerOf(share, 'project').overriddenBy).toBeUndefined();

  expect(catalog.answerOf(share, 'user')).toMatchObject({
    own: 0.3,
    inherited: 0.2,
    inheritedFrom: 'default',
    overriddenBy: { scope: 'project', value: 0.27 },
  });
});

test('a layer that said nothing owns no value', async () => {
  const catalog = await read();
  const traces = catalog.entries[2]!;

  expect(catalog.answerOf(traces, 'user').own).toBeUndefined();
  expect(catalog.answerOf(traces, 'user').inherited).toBe(5368709120);
});

test('a refused write stands on the row it was typed into, in the gate\u2019s own words', async () => {
  const catalog = await read();
  answer = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/api/op/read_settings') return json({ status: 'ok', project: { id: 1, name: 'demo' }, settings: CATALOG });
    if (url.pathname !== '/api/op/write_setting_layer') throw new Error(`Unexpected request ${url.pathname}`);
    return json({ code: 'setting-scope', reason: 'orientation.mapBudget is decided per project.', unblock: ['name the project'] }, 409);
  };

  await catalog.write({ scope: 'user', key: 'orientation.mapBudget', value: 900 });

  expect(catalog.entries[1]?.value).toBe(1250);
  expect(catalog.outcomes['orientation.mapBudget']).toMatchObject({
    kind: 'refused',
    code: 'setting-scope',
    reason: 'orientation.mapBudget is decided per project.',
    unblock: ['name the project'],
  });
});

test('the page holds the keys a person SETS: a key a machine writes for itself is not one of them', async () => {
  const catalog = await read();

  expect(catalog.entries.map((entry) => entry.id)).toEqual(['agent.toolOutputShare', 'orientation.mapBudget', 'telemetry.maxBytes']);
  expect(catalog.entriesOf('terminal')).toEqual([]);
  expect(catalog.setCount('user', 'terminal')).toBe(0);
});

test('a key an app section holds stands in that section, whatever section the catalog files it under', async () => {
  const holding = { id: 'context', group: 'agent', order: 2, icon: {} as never, keys: ['agent.toolOutputShare'] } as const;
  const catalog = await read(registry(holding));

  expect(catalog.entriesOf('context').map((entry) => entry.id)).toEqual(['agent.toolOutputShare']);
  expect(catalog.entriesOf('agent')).toEqual([]);
});

test('the count a layer carries is what THAT layer decided, never what happens to be in force', async () => {
  const catalog = await read();

  expect(catalog.setCount('project', 'agent')).toBe(1);
  expect(catalog.setCount('user', 'agent')).toBe(1);
  expect(catalog.setCount('user', 'telemetry')).toBe(0);
  expect(catalog.setCount('project', 'orientation')).toBe(1);
  expect(catalog.setCount('user', 'orientation')).toBe(0);
});
