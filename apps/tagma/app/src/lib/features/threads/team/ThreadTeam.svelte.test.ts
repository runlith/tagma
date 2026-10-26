// @vitest-environment jsdom
import { NO_REVIEW, type ReviewPolicy, type TeamEdit, type TeamLayer } from '@runlith/agent/collaboration/team';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Door } from '$lib/wire/Door.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import { TeamRepo } from './TeamRepo.js';
import { ThreadTeam } from './ThreadTeam.svelte.js';

await loadOperations();

const OPUS = { provider: 'anthropic', model: 'claude-opus', reasoning: 'high' };
const ROW = {
  ...OPUS,
  open: 9,
  depth: 9,
  taste: 9,
  ui: 7,
  spend: 5,
  only: [],
  not: [],
  note: null,
  operatorOnly: false,
  on: true,
  shipped: true,
};
const PROJECT_REVIEW: ReviewPolicy = { reviewers: 1, pool: [OPUS], split: 'same', lenses: [] };

type Project = { models: readonly TeamEdit[] | null; review: ReviewPolicy | null };

function json(body: unknown): Response {
  const text = JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Response(text, { headers: { 'content-type': 'application/json' } }), { arrayBuffer: async () => buffer });
}

class Server {
  project: Project = { models: [{ provider: 'openai', on: false }], review: PROJECT_REVIEW };
  copy: TeamLayer | null = null;

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (new URL(request.url).pathname) {
      case '/api/op/read_team': {
        const edits = this.copy?.models ?? this.project.models ?? [];
        const review = this.copy?.review ?? this.project.review ?? NO_REVIEW;
        const setAt = this.copy === null ? null : 'thread-1';
        return json({
          status: 'read',
          threadId: 'thread-1',
          team: { models: [ROW], off: [], review },
          edits,
          differs: this.copy !== null,
          own: this.copy,
          setAt,
        });
      }
      case '/api/op/set_thread_team':
        this.copy = payload.team as TeamLayer | null;
        return json({ status: 'set', threadId: 'thread-1', own: this.copy, setAt: this.copy === null ? null : 'thread-1' });
      case '/api/op/promote_thread_team': {
        const previous = this.project;
        const promoted = this.copy;
        if (promoted !== null) this.project = { models: promoted.models, review: promoted.review };
        this.copy = null;
        return json({ status: 'promoted', threadId: 'thread-1', promoted, previous });
      }
      case '/api/op/write_setting_layer': {
        const field = payload.key === 'agent.models' ? 'models' : 'review';
        this.project = { ...this.project, [field]: payload.value ?? null };
        return json({ status: 'ok', project: { id: 1, name: 'one' }, settings: { sections: [], entries: [], rejections: [] } });
      }
    }
    throw new Error(`Unexpected request ${request.url}`);
  };
}

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function open(server: Server): { team: ThreadTeam; notices: Notices } {
  app = mountShell(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false } } }), TeamRepo, SettingsRepo, Notices, ThreadTeam),
    Layer.of(Door, testDoor(server.fetch)),
    { thread: { id: 'thread-1' } },
  );
  return { team: app.app.resolve(ThreadTeam, app.app.scopeOf('thread')), notices: app.app.resolve(Notices) };
}

async function standing(team: ThreadTeam): Promise<void> {
  team.refresh();
  await vi.waitFor(() => expect(team.read).toBeDefined());
}

test('a change in the menu becomes the thread’s own copy, taken from the project, and leaves the project as it was', async () => {
  const server = new Server();
  const { team } = open(server);
  await standing(team);

  await team.edit({ ...OPUS, on: false });

  expect(team.differs).toBe(true);
  expect(server.copy).toEqual({
    models: [
      { provider: 'openai', on: false },
      { ...OPUS, on: false },
    ],
    review: PROJECT_REVIEW,
  });
  expect(server.project).toEqual({ models: [{ provider: 'openai', on: false }], review: PROJECT_REVIEW });
});

test('Use for all threads makes the copy the project’s and offers Undo, which puts back the project and the thread’s copy', async () => {
  const server = new Server();
  const before = server.project;
  const { team, notices } = open(server);
  await standing(team);
  await team.review({ ...PROJECT_REVIEW, reviewers: 0 });
  const copy = server.copy;

  await team.promote();

  expect(server.project).toEqual(copy);
  expect(server.copy).toBeNull();
  expect(team.differs).toBe(false);
  const offered = notices.list.find((notice) => notice.kind === 'undo');
  expect(offered?.undo).toBeDefined();

  offered?.undo?.();

  await vi.waitFor(() => expect(server.copy).toEqual(copy));
  expect(server.project).toEqual(before);
});
