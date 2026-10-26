import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { eq, sql } from 'drizzle-orm';
import { modelPreference } from '../../../native-harness/testing/doubles.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { modelDefaults } from '../claudeLogin.js';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { makeDoorWorld } from '../doorFixture.js';

const setup = Effect.gen(function* () {
  const world = yield* makeDoorWorld();
  return { world, projectId: yield* world.stealthProject(), elsewhere: yield* world.stealthProject() };
});
class Place extends Context.Service<Place, Effect.Success<typeof setup>>()('testing/ThreadsDoor') {}

const call = (path: string, init?: { method?: string; body?: unknown }) => Effect.flatMap(Place, ({ world }) => world.call(path, init));
const fetched = (url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array | string } = {}) =>
  Effect.flatMap(Place, ({ world }) => Effect.promise((signal) => world.app(new Request(url, { ...init, signal }), world.runtime.graph)));
const bytes = (response: Response) => Effect.promise(() => response.arrayBuffer()).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
const json = <A>(response: Response) => Effect.promise(() => response.json() as Promise<A>);

const perform = Effect.fnUntraced(function* (id: string, init?: { readonly body?: unknown }) {
  const { projectId } = yield* Place;
  const response = yield* call(`/api/op/${id}?project=${projectId}`, { method: 'POST', body: init?.body ?? {} });
  if (response.status !== 200) return response;
  const { status: _, ...answer } = response.body as Record<string, unknown>;
  return { ...response, body: answer };
});
const created = Effect.fnUntraced(function* (body: unknown = {}) {
  const { projectId } = yield* Place;
  return yield* call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body });
});

const isolateModels = Effect.gen(function* () {
  const { world } = yield* Place;
  const { db } = Context.get(world.runtime.owners, MachineStore);
  const units = Context.get(world.runtime.owners, MachineUnits);
  const table = modelPreference();
  const previous = yield* units.read((unit) => unit.run(db.select().from(table).where(eq(table.principalId, OPERATOR_PRINCIPAL)).get()));
  const accounts = Context.get(world.runtime.owners, DefaultAccounts);
  const chosen = yield* accounts.defaultAccount('subscription');
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* accounts.saveDefaultAccount('subscription', chosen.account);
      yield* units.write('threadsDoor.restoreModels', (unit) =>
        unit.run(
          previous === undefined
            ? db.delete(table).where(eq(table.principalId, OPERATOR_PRINCIPAL))
            : db.insert(table).values(previous).onConflictDoUpdate({ target: table.principalId, set: previous }),
        ),
      );
    }).pipe(Effect.orDie),
  );
  yield* units.write('threadsDoor.isolateModels', (unit) =>
    unit.run(db.update(table).set({ defaultSwitches: {}, favoriteModels: [] }).where(eq(table.principalId, OPERATOR_PRINCIPAL))),
  );
});

type Switches = Record<string, string>;
type ThreadBody = {
  snapshot: { thread: { id: string; ownerId: string; account: string | null; switches: Switches } & Record<string, unknown> };
};
const thread = (answer: { body: unknown }) => (answer.body as ThreadBody).snapshot.thread;

layer(Layer.effect(Place, setup), { excludeTestServices: true })('threads HTTP door', (it) => {
  it.effect('token ingress adds one catalog subscription account and refuses anything else', () =>
    Effect.gen(function* () {
      const { world } = yield* Place;
      const defaults = Context.get(world.runtime.owners, DefaultAccounts);
      const chosen = yield* defaults.defaultAccount('openai-oauth');
      yield* Effect.addFinalizer(() => defaults.saveDefaultAccount('openai-oauth', chosen.account).pipe(Effect.orDie));
      const previous = yield* world.runtime.tokens.get('openai-oauth', AccountKey.make('only'));
      yield* Effect.addFinalizer(() =>
        (previous === null
          ? world.runtime.tokens.remove('openai-oauth', AccountKey.make('only'))
          : world.runtime.tokens.add('openai-oauth', previous.credential).pipe(Effect.asVoid)
        ).pipe(Effect.orDie),
      );
      const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresAt: (yield* Clock.currentTimeMillis) + 3_600_000 };
      const added = yield* world.op('read_provider_token', { provider: 'openai-oauth', credential: tokens });
      expect(added.status).toBe(200);
      expect(added.body).toMatchObject({ status: 'kept', account: { provider: 'openai-oauth', account: 'only', origin: { kind: 'own' } } });
      expect(yield* world.runtime.tokens.accounts('openai-oauth')).toMatchObject([{ credential: { accessToken: 'access' } }]);
      const refused = yield* world.op('read_provider_token', { provider: 'openai', credential: tokens });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'unknown-provider' });
    }),
  );

  it.effect('an image, a PDF and a dropped file land beside the database, and die with their thread', () =>
    Effect.gen(function* () {
      const { projectId, elsewhere } = yield* Place;
      const threadId = thread(yield* created()).id;
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
        (character) => character.charCodeAt(0),
      );
      const uploaded = yield* fetched(`http://tagma/api/threads/${threadId}/attachments?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      });
      expect(uploaded.status).toBe(201);
      const attachment = yield* json<{ id: string; url: string; mediaType: string }>(uploaded);
      expect(attachment.mediaType).toBe('image/png');
      expect(attachment.url).toBe(`/api/threads/${threadId}/attachments/${attachment.id}`);
      const served = yield* fetched(`http://tagma${attachment.url}?project=${projectId}`);
      expect(served.status).toBe(200);
      const stranger = yield* fetched(`http://tagma${attachment.url}?project=${elsewhere}`);
      expect(stranger.status).toBe(409);
      expect(yield* bytes(stranger)).not.toEqual(png);
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(yield* bytes(served)).toEqual(png);
      const refused = yield* fetched(`http://tagma/api/threads/${threadId}/attachments?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: png,
      });
      expect(refused.status).toBe(409);
      expect(yield* json<{ code: string }>(refused)).toMatchObject({ code: 'unsupported-media-type' });
      const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
      const name = 'Договор №5.pdf';
      const filed = yield* fetched(
        `http://tagma/api/threads/${threadId}/attachments?project=${projectId}&name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: pdf },
      );
      expect(filed.status).toBe(201);
      const kept = yield* json<{ url: string; mediaType: string }>(filed);
      expect(kept.mediaType).toBe('application/pdf');
      const opened = yield* fetched(`http://tagma${kept.url}?project=${projectId}`);
      expect(opened.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent(name)}`);
      expect(yield* bytes(opened)).toEqual(pdf);
      const notPdf = yield* fetched(`http://tagma/api/threads/${threadId}/attachments?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/pdf' },
        body: png,
      });
      expect(notPdf.status).toBe(409);
      expect(yield* json<{ code: string }>(notPdf)).toMatchObject({ code: 'attachment-rejected' });
      const mislabelled = yield* fetched(`http://tagma/api/threads/${threadId}/attachments?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: png,
      });
      expect(mislabelled.status).toBe(409);
      expect(yield* json<{ code: string }>(mislabelled)).toMatchObject({ code: 'attachment-rejected' });
      const dropped = yield* fetched(
        `http://tagma/api/threads/${threadId}/drops?project=${projectId}&name=${encodeURIComponent('Снимок экрана 1.png')}`,
        { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: png.subarray(0, 9) },
      );
      expect(dropped.status).toBe(201);
      const { path } = yield* json<{ path: string }>(dropped);
      expect(basename(path)).toBe('Снимок экрана 1.png');
      expect(new Uint8Array(readFileSync(path))).toEqual(png.subarray(0, 9));
      yield* perform('delete_thread', { body: { threadId } });
      const gone = yield* fetched(`http://tagma${attachment.url}?project=${projectId}`);
      expect(gone.status).toBe(404);
      expect(yield* json<{ code: string }>(gone)).toMatchObject({ code: 'not-found' });
      expect(existsSync(path)).toBe(false);
    }),
  );

  it.effect(
    'thread births keep validated accounts and per-model switches across provider changes, with explicit draft choices winning',
    () =>
      Effect.gen(function* () {
        const { world } = yield* Place;
        yield* isolateModels;
        yield* modelDefaults(world, {
          account: null,
          provider: 'openai-oauth',
          model: 'gpt-5.6-sol',
          reasoning: null,
          switches: { serviceTier: 'priority' },
        });
        const initial = yield* perform('read_model_defaults');
        expect(initial.status).toBe(200);
        expect(initial.body).toMatchObject({ provider: 'openai-oauth', account: null, switches: { serviceTier: 'priority' } });
        expect(thread(yield* created())).toMatchObject({ account: null, switches: { serviceTier: 'priority' } });
        const other = yield* perform('set_model_defaults', {
          body: { account: null, provider: 'openai-oauth', model: 'gpt-6-astra', reasoning: null },
        });
        expect((other.body as { switches: Switches }).switches).toEqual({});
        expect((yield* perform('read_model_defaults')).body).toMatchObject({
          model: 'gpt-6-astra',
          remembered: { 'openai-oauth': { 'gpt-5.6-sol': { serviceTier: 'priority' } } },
        });
        const standard = thread(yield* created());
        expect(standard.switches).toEqual({});
        const back = yield* perform('set_model_defaults', {
          body: { account: null, provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: null },
        });
        expect((back.body as { switches: Switches }).switches).toEqual({ serviceTier: 'priority' });
        const enabled = yield* perform('set_thread_model', {
          body: {
            threadId: standard.id,
            provider: 'openai-oauth',
            model: 'gpt-5.6-sol',
            reasoning: null,
            switches: { serviceTier: 'priority' },
          },
        });
        expect(enabled.status).toBe(200);
        expect(thread(enabled).switches).toEqual({ serviceTier: 'priority' });
        expect(
          (yield* perform('set_thread_model', {
            body: {
              threadId: standard.id,
              provider: 'openai-oauth',
              model: 'gpt-5.6-sol',
              reasoning: null,
              switches: { reasoningDisplay: 'summarized' },
            },
          })).status,
        ).toBe(409);

        const credential = (uuid: string, expiresAt: number) => ({
          accessToken: `access-${uuid}`,
          refreshToken: `refresh-${uuid}`,
          expiresAt,
          scope: 'user:inference',
          account: { uuid, email: `${uuid}@example.com` },
          organization: { uuid: `org-${uuid}`, name: uuid },
        });
        const expiresAt = (yield* Clock.currentTimeMillis) + 3_600_000;
        const first = yield* Effect.acquireRelease(
          world.runtime.tokens.add('subscription', credential(crypto.randomUUID(), expiresAt)),
          (key) => world.runtime.tokens.remove('subscription', key).pipe(Effect.orDie),
        );
        const second = yield* Effect.acquireRelease(
          world.runtime.tokens.add('subscription', credential(crypto.randomUUID(), expiresAt)),
          (key) => world.runtime.tokens.remove('subscription', key).pipe(Effect.orDie),
        );
        const choose = (account: string | null, switches?: Switches) =>
          perform('set_model_defaults', {
            body: { account, provider: 'subscription', model: 'claude-opus-5-5', reasoning: null, switches },
          });
        const saved = yield* choose(first, { reasoningDisplay: 'summarized' });
        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({
          account: first,
          provider: 'subscription',
          model: 'claude-opus-5-5',
          switches: { reasoningDisplay: 'summarized' },
        });
        const unknown = yield* choose('missing');
        expect(unknown.status).toBe(409);
        expect(unknown.body).toMatchObject({ code: 'unknown-account' });
        expect((unknown.body as { unblock: string[] }).unblock.join(' ')).toContain(first);
        expect((unknown.body as { unblock: string[] }).unblock.join(' ')).toContain(second);
        const born = yield* created();
        expect(born.status).toBe(200);
        const threadId = thread(born).id;
        expect(thread(born)).toMatchObject({
          account: null,
          provider: 'subscription',
          model: 'claude-opus-5-5',
          switches: { reasoningDisplay: 'summarized' },
        });
        const moved = yield* choose(second);
        expect(moved.status).toBe(200);
        expect(moved.body).toMatchObject({ account: second });
        expect(thread(yield* perform('read_thread_snapshot', { body: { threadId } }))).toMatchObject({
          account: null,
          provider: 'subscription',
          model: 'claude-opus-5-5',
          switches: { reasoningDisplay: 'summarized' },
        });
        expect(thread(yield* created({ account: first, switches: { reasoningDisplay: 'omitted' } }))).toMatchObject({
          account: first,
          switches: { reasoningDisplay: 'omitted' },
        });
        const unknownDraft = yield* created({ account: 'missing' });
        expect(unknownDraft.status).toBe(409);
        expect(unknownDraft.body).toMatchObject({ code: 'unknown-account' });
        expect((yield* choose(null, { reasoningDisplay: 'omitted' })).body).toMatchObject({ switches: { reasoningDisplay: 'omitted' } });
        const away = yield* perform('set_model_defaults', {
          body: { account: null, provider: 'openai-oauth', model: 'gpt-5.6-sol', reasoning: null },
        });
        expect(away.status).toBe(200);
        expect((away.body as { switches: Switches }).switches).toEqual({ serviceTier: 'priority' });
        expect((yield* choose(null)).body).toMatchObject({ switches: { reasoningDisplay: 'omitted' } });
        expect(thread(yield* created())).toMatchObject({ account: null, switches: { reasoningDisplay: 'omitted' } });
      }),
  );

  it.effect('the door refuses a nameless thread born of a session, and a blank name from anyone', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Place;
      const blank = yield* call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: { title: '   ' } });
      expect(blank.status).toBe(409);
      expect(blank.body).toMatchObject({ code: 'title-empty' });
      const signed = yield* fetched(`http://tagma/api/op/create_thread?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tagma-session': 'claude-code:proof-thread' },
        body: JSON.stringify({}),
      });
      expect(signed.status).toBe(409);
      expect(yield* json<unknown>(signed)).toMatchObject({ code: 'title-required' });
      const draft = yield* call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: {} });
      expect(draft.status).toBe(200);
      const parentId = thread(draft).id;
      const child = yield* fetched(`http://tagma/api/op/create_thread?project=${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tagma-session': 'bench:child-door' },
        body: JSON.stringify({ type: 'harness:devin', parent: parentId, task: 'read the owner' }),
      });
      expect(child.status).toBe(200);
      expect(thread({ body: yield* json<unknown>(child) })).toMatchObject({ parentThreadId: parentId, agentId: 'harness' });
    }),
  );

  it.effect('the roots door answers the window and pages it by the cursor the window named', () =>
    Effect.gen(function* () {
      const { elsewhere: projectId } = yield* Place;
      for (const title of ['first root', 'second root', 'third root']) {
        yield* call(`/api/op/create_thread?project=${projectId}`, { method: 'POST', body: { title } });
      }
      const opened = yield* call(`/api/op/list_thread_window?project=${projectId}`, { method: 'POST', body: {} });
      expect(opened.status).toBe(200);
      const window = opened.body as { rows: { title: string; readerOrderAt: string }[]; roots: number; windowBefore: string | null };
      expect(window.rows.map((row) => row.title)).toEqual(['third root', 'second root', 'first root']);
      expect(window.roots).toBe(3);
      expect(window.windowBefore).toBeNull();
      const newest = window.rows[0]?.readerOrderAt ?? '';
      const older = yield* call(`/api/op/list_thread_window?project=${projectId}`, { method: 'POST', body: { readerBefore: newest } });
      expect(older.status).toBe(200);
      expect((older.body as { rows: { title: string }[] }).rows.map((row) => row.title)).toEqual(['second root', 'first root']);
      const refused = yield* call(`/api/op/list_thread_window?project=${projectId}`, {
        method: 'POST',
        body: { readerBefore: 'yesterday' },
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'selection-shape' });
    }),
  );

  it.effect('the seen door acknowledges only the latest terminal run named by the reader', () =>
    Effect.gen(function* () {
      const { world, projectId } = yield* Place;
      const { id: threadId, ownerId } = thread(yield* created({ title: 'outcome worker' }));
      const earlierRunId = '019d0000-0000-7000-8000-000000000301';
      const latestRunId = '019d0000-0000-7000-8000-000000000302';
      const store = Context.get(world.runtime.graph, MachineStore);
      const units = Context.get(world.runtime.graph, MachineUnits);
      const earlierAt = Date.parse('2026-08-31T19:00:00.000Z');
      const latestAt = Date.parse('2026-08-31T19:01:00.000Z');
      yield* units.write('threadsDoor', (tx) =>
        tx.run(
          store.db.run(
            sql`insert into thread_run (id, thread_id, status, owner_id, finished_at, started_at, heartbeat_at, created_at, updated_at) values (${earlierRunId}, ${threadId}, 'completed', ${ownerId}, ${earlierAt}, ${earlierAt}, ${earlierAt}, ${earlierAt}, ${earlierAt}), (${latestRunId}, ${threadId}, 'completed', ${ownerId}, ${latestAt}, ${latestAt}, ${latestAt}, ${latestAt}, ${latestAt})`,
          ),
        ),
      );
      const stale = yield* call(`/api/op/mark_thread_seen?project=${projectId}`, {
        method: 'POST',
        body: { threadId, runId: earlierRunId },
      });
      expect(stale.status).toBe(200);
      expect(stale.body).toMatchObject({ outcome: { runId: latestRunId, status: 'completed', isSeen: false } });
      const seen = yield* call(`/api/op/mark_thread_seen?project=${projectId}`, { method: 'POST', body: { threadId, runId: latestRunId } });
      expect(seen.status).toBe(200);
      expect(seen.body).toMatchObject({ outcome: { runId: latestRunId, status: 'completed', isSeen: true } });
    }),
  );

  it.effect('the favorites door stores the pairs as handed, refuses an unregistered row by name, and leaves the defaults alone', () =>
    Effect.gen(function* () {
      yield* isolateModels;
      const empty = yield* perform('read_model_favorites');
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ models: [] });
      const before = yield* perform('read_model_defaults');
      const pinned = [
        { provider: 'openai-oauth', model: 'gpt-5.6-sol' },
        { provider: 'subscription', model: 'claude-opus-5-5' },
      ];
      const saved = yield* perform('set_model_favorites', { body: { models: pinned } });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ models: pinned });
      expect((yield* perform('read_model_favorites')).body).toEqual({ models: pinned });
      expect((yield* perform('read_model_defaults')).body).toEqual(before.body);
      const unknownProvider = yield* perform('set_model_favorites', { body: { models: [{ provider: 'nobody-oauth', model: 'x' }] } });
      expect(unknownProvider.status).toBe(409);
      expect(unknownProvider.body).toMatchObject({ code: 'provider-not-installed' });
      const unknownModel = yield* perform('set_model_favorites', {
        body: { models: [{ provider: 'subscription', model: 'claude-nobody' }] },
      });
      expect(unknownModel.status).toBe(409);
      expect((yield* perform('read_model_favorites')).body).toEqual({ models: pinned });
      const cleared = yield* perform('set_model_favorites', { body: { models: [] } });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toEqual({ models: [] });
    }),
  );
});
