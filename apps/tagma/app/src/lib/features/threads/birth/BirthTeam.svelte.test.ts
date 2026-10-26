// @vitest-environment jsdom
import { NO_REVIEW, type ReviewPolicy, type TeamEdit, type TeamLayer } from '@runlith/agent/collaboration/team';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { testShelf } from '../native/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Door } from '$lib/wire/Door.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import { ThreadDraft } from '../Draft.svelte.js';
import { TeamRepo } from '../team/TeamRepo.js';
import { BirthTeam } from './BirthTeam.svelte.js';

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
  project: Project = { models: [], review: PROJECT_REVIEW };
  readonly copies = new Map<string, TeamLayer | null>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (new URL(request.url).pathname) {
      case '/api/op/read_team': {
        const copy = (payload.team as TeamLayer | undefined) ?? null;
        const review = copy?.review ?? this.project.review ?? NO_REVIEW;
        const edits = copy?.models ?? this.project.models ?? [];
        return json({
          status: 'read',
          threadId: null,
          team: { models: [ROW], off: [], review },
          edits,
          differs: copy !== null,
          own: null,
          setAt: null,
        });
      }
      case '/api/op/promote_thread_team': {
        const previous = this.project;
        const promoted = payload.team as TeamLayer;
        this.project = { models: promoted.models, review: promoted.review };
        return json({ status: 'promoted', threadId: null, promoted, previous });
      }
      case '/api/op/set_thread_team':
        this.copies.set(payload.threadId as string, payload.team as TeamLayer | null);
        return json({ status: 'set', threadId: payload.threadId, own: payload.team, setAt: payload.threadId });
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

test('Undo of a draft’s Use for all threads, after the draft was sent, puts the project back and gives the copy to the thread it bore', async () => {
  const server = new Server();
  const before = server.project;
  app = mountShell(
    Layer.mergeAll(Cache.of({ defaultOptions: { queries: { retry: false } } }), TeamRepo, SettingsRepo, Notices),
    Layer.of(Door, testDoor(server.fetch)),
  );
  const notices = app.app.resolve(Notices);
  const draft = new ThreadDraft(testShelf(), {} as never, {} as never);
  draft.useKey('new:1');
  const born = new Map<string, string>();
  const team = new BirthTeam(draft, app.app.resolve(TeamRepo), app.app.resolve(SettingsRepo), notices, 1, (key) => born.get(key) ?? null);
  team.refresh();
  await vi.waitFor(() => expect(team.layer).not.toBeNull());
  await team.review({ ...PROJECT_REVIEW, reviewers: 0 });
  const copy = draft.team;

  await team.promote();
  born.set('new:1', 'thread-9');
  draft.useKey('thread:thread-9');
  notices.list.find((notice) => notice.kind === 'undo')?.undo?.();

  await vi.waitFor(() => expect(server.copies.get('thread-9')).toEqual(copy));
  expect(server.project).toEqual(before);
});
