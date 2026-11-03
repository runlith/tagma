// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, soloWorkspace, type TestApp } from '$lib/app/testing.js';
import { Checkout } from '$lib/features/checkout/Selection.svelte.js';
import { BlocksRepo } from '$lib/features/graph/BlocksRepo.js';
import { SessionRegistry } from '$lib/features/graph/SessionRegistry.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { Asking } from '$lib/features/threads/Asking.js';
import { GraphDoor } from '$lib/features/workspace/GraphDoor.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { RulesRepo } from './Repo.js';
import RulePanel from './RulePanel.svelte';

await loadCatalog();
let app: TestApp | undefined;
afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a colliding rule opens its own enforcement', async () => {
  const identity = '0199000000007000800000001234abcd';
  const row = {
    rule: '1234abcd',
    title: 'Rule',
    places: [],
    delivery: 'prompt',
    enabled: true,
    inspection: 'precise-check',
    function: null,
    unreadable: false,
    strictness: 'gate',
    on: [],
    checker: null,
    debt: { count: 0, owners: 0, was: null },
    escaped: 0,
    refused: null,
    measured: null,
  };
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const body = (await request.json()) as { rule?: string };
    if (body.rule !== identity)
      return new Response(JSON.stringify({ code: 'ambiguous-name', reason: 'Two rules', unblock: ['Use the full name'] }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    return new Response(
      JSON.stringify({
        status: 'ok',
        graph: null,
        engine: {
          row,
          body: '',
          generalFix: null,
          base: 'head',
          figures: [],
          owners: [],
          history: [],
          historyEnds: null,
          revision: null,
          changed: null,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  app = mountShell(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false } } }), GraphDoor, BlocksRepo, RulesRepo),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(TagCatalog, { bearsLaw: () => true, enforced: () => true, workTag: null } as never),
      Layer.of(SessionRegistry, { writerOf: () => null } as never),
      Layer.of(Notices, { refusal: () => undefined } as never),
      Layer.of(Opening, {} as never),
      Layer.of(Asking, {} as never),
      Layer.of(Checkout, { row: null } as never),
      Layer.of(Workspace, soloWorkspace({ active: { id: 1, name: 'home' }, contextProject: { id: 1, name: 'home' } })),
    ),
    { at: { projectId: 1, branch: null } },
  );
  const panel = app.draw(RulePanel as never, { read: { name: '1234abcd', identity, updatedAt: '2026-09-05T00:00:00Z' } });
  await vi.waitFor(() => expect(panel.querySelector('section')).not.toBeNull());
});

test('enforcing a colliding rule assigns the newly created debt owner by identity', async () => {
  const identity = '0199000000007000800000001234abcd';
  const owner = '0199000000007000800000005678abcd';
  let enforced: { rule: string; owner: string } | null = null;
  let refusal: unknown;
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const body = (await request.json()) as Record<string, unknown>;
    if (path === '/api/op/read_config')
      return json({
        status: 'ok',
        config: { inspections: [{ key: 'precise-check', inspection: 'size', concern: null }], format: [], derive: [] },
      });
    if (path === '/api/op/check_rules' && body.blockId === identity)
      return json({
        status: 'ok',
        over: 'all',
        head: 'head',
        paths: [],
        violations: [],
        shown: 0,
        total: 1,
        next: null,
        fingerprints: [],
        unjudged: [],
        rules: [],
        reader: null,
      });
    if (path === '/api/op/create_block' && body.parentId === identity)
      return json({
        status: 'ok',
        block: {
          identity: owner,
          rowKey: 2,
          name: '5678abcd',
          projectId: 1,
          parentIdentity: identity,
          parentName: '1234abcd',
          ord: 1,
          tags: ['task'],
          fields: {},
          actions: { moves: [], slots: [], offers: [], revision: '' },
          title: 'Debt',
          body: '',
          superseded: false,
          blocked: false,
          building: false,
          answered: false,
          deletedAt: null,
          createdAt: '2026-09-05T00:00:00Z',
          updatedAt: '2026-09-05T00:00:00Z',
        },
      });
    if (path === '/api/op/enforce_rule' && body.blockId === identity && body.owner === owner) {
      enforced = { rule: body.blockId, owner: body.owner };
      return json({
        status: 'ok',
        block: { name: '1234abcd' },
        rule: '1234abcd',
        title: 'Rule',
        strictness: 'watch',
        was: null,
        on: [],
        inspection: 'precise-check',
        head: 'head',
        places: [],
        debt: { before: 0, after: 1 },
        absorbed: [],
        retired: [],
        escaped: 0,
        unjudged: [],
        ms: 0,
        revision: null,
        graph: null,
      });
    }
    return new Response(JSON.stringify({ code: 'ambiguous-name', reason: 'Two blocks', unblock: ['Use the full name'] }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  };
  app = mountShell(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false } } }), GraphDoor, BlocksRepo, RulesRepo),
    Layer.mergeAll(
      Layer.of(Door, testDoor(answer)),
      Layer.of(TagCatalog, { bearsLaw: () => true, enforced: () => false, switchedOff: () => false, workTag: 'task' } as never),
      Layer.of(Notices, {
        refusal: (error: unknown) => {
          refusal = error;
        },
      } as never),
      Layer.of(Asking, {} as never),
      Layer.of(Checkout, { row: null } as never),
      Layer.of(Workspace, soloWorkspace({ active: { id: 1, name: 'home' }, contextProject: { id: 1, name: 'home' } })),
    ),
    { at: { projectId: 1, branch: null } },
  );
  const panel = app.draw(RulePanel as never, { read: { name: '1234abcd', identity, updatedAt: '2026-09-05T00:00:00Z' } });
  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((one) => one.textContent?.includes(text)) as HTMLButtonElement | undefined;
  await vi.waitFor(() => expect(button(panel, 'Make it a check')).toBeDefined());
  button(panel, 'Make it a check')!.click();
  await vi.waitFor(() => expect(button(document, 'precise-check')).toBeDefined());
  button(document, 'precise-check')!.click();
  await vi.waitFor(() => expect(button(document, 'Use this check')?.disabled).toBe(false));
  button(document, 'Use this check')!.click();
  await vi.waitFor(() => {
    if (refusal !== undefined) throw refusal;
    expect(enforced).toEqual({ rule: identity, owner });
  });
});
