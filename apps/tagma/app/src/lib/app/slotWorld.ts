import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { DetachedSessions } from '@runlith/chat-ui/session/DetachedSessions';
import { PendingTurns } from '@runlith/chat-ui/session/PendingTurns';
import { ThreadStops } from '@runlith/chat-ui/session/ThreadStops.svelte';
import { TurnShaping } from '@runlith/chat-ui/session/TurnShaping';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { MemoryShelf } from '@runlith/chat-ui/testing/pendingShelf';
import { ChatConnection, type ChatThreadView } from '@runlith/chat-ui/wire/ChatConnection';
import { Layer } from '@runlith/layer/Layer';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { makePoint, makeStorage } from '@runlith/layer/testing';
import { StagedKinds } from '$lib/shared/threads/staged.js';
import { keyed } from '@runlith/query/builders/keyed';
import { stubFamily, stubMutation, stubSingle } from '@runlith/query/testing';
import { QueryClient } from '@tanstack/query-core';
import type { AgentSkillCatalog } from '@tagma/server/threads/contract/wire/agentLibrary';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Effect, Scope as EffectScope } from 'effect';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { FileOpener } from '$lib/features/checkout/files/FileOpener.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { testProviderCatalog } from '$lib/features/providers/testing.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { AgentTypes } from '$lib/features/threads/AgentTypes.svelte.js';
import { Births } from '$lib/features/threads/Births.svelte.js';
import { Favorites } from '$lib/features/threads/Favorites.svelte.js';
import { ThreadList } from '$lib/features/threads/List.svelte.js';
import { ModelDefaults } from '$lib/features/threads/ModelDefaults.svelte.js';
import { ThreadsRepo } from '$lib/features/threads/Repo.js';
import { Runner } from '$lib/features/threads/Runner.js';
import type { SlotContext, SlotWriter } from '$lib/features/threads/SlotSelection.svelte.js';
import { ThreadSlot, type SlotOptions } from '$lib/features/threads/ThreadSlot.svelte.js';
import { type ThreadChat, ThreadChats } from '$lib/features/threads/ThreadChats.js';
import type { SkillCatalogKey } from '$lib/features/threads/library/AgentLibraryRepo.js';
import type { DraftShelf } from '$lib/features/threads/native/DraftShelf.svelte.js';
import { ProductRecords } from '$lib/features/threads/native/records.js';
import { SkillCatalog } from '$lib/features/threads/native/SkillCatalog.svelte.js';
import { SurfaceChoices } from '$lib/features/threads/external/Surface.svelte.js';
import { testRecords, testShelf } from '$lib/features/threads/native/testing.js';
import { TeamRepo } from '$lib/features/threads/team/TeamRepo.js';
import { ThreadAuthority } from '$lib/features/threads/thread/ThreadAuthority.svelte.js';
import { ThreadCompaction } from '$lib/features/threads/thread/ThreadCompaction.svelte.js';
import { ThreadComposition } from '$lib/features/threads/thread/ThreadComposition.svelte.js';
import { ThreadContext } from '$lib/features/threads/thread/ThreadContext.svelte.js';
import { ThreadEffects } from '$lib/features/threads/thread/ThreadEffects.js';
import { ThreadFeed } from '$lib/features/threads/thread/ThreadFeed.svelte.js';
import { ThreadInstructions } from '$lib/features/threads/thread/ThreadInstructions.js';
import { ThreadPlace } from '$lib/features/threads/thread/ThreadPlace.svelte.js';
import { ThreadRecap } from '$lib/features/threads/thread/ThreadRecap.svelte.js';
import { ThreadSettings } from '$lib/features/threads/thread/ThreadSettings.svelte.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live, type LiveConnection, CallFailed } from '$lib/wire/Live.js';
import { refusalOf } from '$lib/wire/refusal.js';
import { testDoor } from '$lib/wire/testing.js';
import { mountShell, testPlaces, testTagCatalog, threadsRepo } from './testing.js';

type SlotParts = {
  projectId: number;
  chat: ThreadChat;
  chats: { of(projectId: number): ThreadChat };
  threads: Record<string, unknown>;
  live: LiveConnection;
  shelf: DraftShelf;
  accounts: UsageAccounts;
  catalog: ProviderCatalog;
  selection: ConstructorParameters<typeof ThreadSlot>[11];
  tags: ConstructorParameters<typeof ThreadSlot>[12];
  settings: ConstructorParameters<typeof ThreadSlot>[13];
  list: ConstructorParameters<typeof ThreadSlot>[4];
  places?: ConstructorParameters<typeof ThreadSlot>[5];
  skills?: SkillCatalog;
  types?: AgentTypes;
  favorites?: Favorites;
  storage?: PlatformStorage;
};

export type TestSlotOptions = SlotOptions & {
  readonly writer?: SlotWriter;
  readonly context?: SlotContext;
  readonly runner?: Runner;
};

type LiveAnswer = (params: unknown, at: { readonly threadId: string }) => Effect.Effect<unknown, never>;

export function testLive(answers: { model?: LiveAnswer; authority?: LiveAnswer } = {}): LiveConnection {
  const none: LiveAnswer = () => Effect.fail(new Error('This test named no thread client.')) as never;
  const client = {
    'thread.model': (input: { threadId: string; params: unknown }) => (answers.model ?? none)(input.params, input),
    'thread.authority': (input: { threadId: string; params: unknown }) => (answers.authority ?? none)(input.params, input),
  };
  return {
    attempt: (work: (client: unknown) => Effect.Effect<unknown, never>) =>
      Effect.mapError(work(client), (error) => new CallFailed({ refusal: refusalOf(error), sent: true })),
  } as unknown as LiveConnection;
}

export function testThreadSlot(over: Partial<SlotParts> = {}, options: TestSlotOptions = {}, scope: Scope = Scope.make()): ThreadSlot {
  return testThreadSlots(over, [options], scope)[0] as ThreadSlot;
}

export function testThreadSlots(over: Partial<SlotParts>, options: readonly TestSlotOptions[], scope: Scope): ThreadSlot[] {
  const projectId = over.projectId ?? 1;
  const { layer, chat, threads, list, places, types, defaults, accounts, favorites, catalog, settings, choices, teams } = slotWorld(
    over,
    scope,
  );
  const world = mountShell(layer, Layer.mergeAll(), { at: { projectId, branch: null } });
  scope.defer(() => world.unmount());
  const shelf = over.shelf ?? testShelf();
  return options.map((one) => {
    const writer = one.writer ?? new TestRoute();
    const slot = new ThreadSlot(
      projectId,
      chat,
      shelf,
      threads,
      list,
      places,
      types,
      defaults,
      accounts,
      favorites,
      catalog,
      over.selection ?? ({ search: stubFamily() } as unknown as SlotParts['selection']),
      over.tags ?? testTagCatalog(),
      settings,
      choices,
      teams,
      new Notices(scope),
      over.skills ?? emptySkills(projectId, scope),
      testDoor(),
      testRecords(),
      makePoint(StagedKinds),
      over.storage ?? makeStorage(),
      scope,
      world.app,
      one.runner ?? new Runner(),
      writer,
      one.context ?? { scopeName: () => null },
      one.pane === undefined ? {} : { pane: one.pane },
    );
    if (writer instanceof TestRoute) {
      writer.follow(slot);
      routed.set(slot, writer);
    }
    return slot;
  });
}

export function slotWorld(over: Partial<SlotParts>, scope: Scope) {
  const projectId = over.projectId ?? 1;
  const chat = over.chat ?? testThreadChat();
  const threads = threadsRepo({
    defaults: stubSingle({
      loadOrThrow: async () => ({
        status: 'read' as const,
        defaults: { account: null, provider: 'openai-oauth', model: 'test', reasoning: null, switches: {} },
        remembered: {},
      }),
    }),
    favorites: stubSingle({ loadOrThrow: async () => ({ models: [] }) }),
    types: stubMutation(),
    ...over.threads,
  });
  const fields = over.list ?? {
    threads: [],
    row: () => undefined,
    births: new Births(
      (projectId) => projectId === 1,
      () => undefined,
      () => undefined,
      () => undefined,
    ),
  };
  const list = Object.create(fields, {
    harnessRow: { value: ThreadList.prototype.harnessRow },
    identityOf: { value: ThreadList.prototype.identityOf },
    titles: { value: ThreadList.prototype.titles },
  }) as SlotParts['list'];
  const types = over.types ?? new AgentTypes(threads, projectId, new Notices(scope), scope);
  const catalog = over.catalog ?? testProviderCatalog();
  const accounts =
    over.accounts ?? ({ rows: [], known: false, providers: [], of: () => [], signing: () => [] } as unknown as UsageAccounts);
  const defaults = new ModelDefaults(threads, new Notices(scope), catalog, accounts, scope);
  const favorites = over.favorites ?? new Favorites(threads, new Notices(scope), scope);
  const settings = over.settings ?? ({ reloadSources: stubMutation(), catalog: stubFamily() } as unknown as SlotParts['settings']);
  const choices = new SurfaceChoices(settings);
  const places = over.places ?? testPlaces();
  const teams = { read: stubFamily(), set: stubMutation(), promote: stubMutation() } as unknown as TeamRepo;
  const live = over.live ?? testLive();
  const layer = Layer.mergeAll(
    Notices,
    ThreadEffects,
    ThreadFeed,
    ThreadSettings,
    ThreadAuthority,
    ThreadCompaction,
    ThreadRecap,
    ThreadInstructions,
    ThreadComposition,
    ThreadPlace,
    ThreadContext,
    Layer.of(FileOpener, { open: () => Promise.resolve(), stand: () => () => undefined } as never),
    Layer.of(ThreadChats, (over.chats ?? { of: () => chat }) as never),
    Layer.of(Live, live as never),
    Layer.of(Door, testDoor()),
    Layer.of(ProductRecords, testRecords()),
    StagedKinds,
    Layer.of(ThreadsRepo, threads),
    Layer.of(TeamRepo, teams),
    Layer.of(UsageAccounts, accounts),
    Layer.of(ProviderCatalog, catalog),
    Layer.of(Favorites, favorites),
    Layer.of(AgentTypes, types),
    Layer.of(ModelDefaults, defaults),
    Layer.of(ThreadList, list),
    Layer.of(SettingsRepo, settings as never),
    Layer.of(SurfaceChoices, choices),
    Layer.of(Worktrees, places),
  );
  return { layer, chat, threads, list, places, types, defaults, accounts, favorites, catalog, settings, choices, teams };
}

export class TestRoute implements SlotWriter {
  private slot: ThreadSlot | null = null;
  private held: (string | null)[] = [];

  get pending(): readonly (string | null)[] {
    return this.held;
  }

  follow(slot: ThreadSlot): void {
    this.slot = slot;
  }

  navigate(threadId: string | null): void {
    this.held.push(threadId);
  }

  open(threadId: string): void {
    this.held.push(threadId);
  }

  rehome(): void {}

  commit(): void {
    const last = this.held.at(-1);
    this.held = [];
    if (last !== undefined && this.slot !== null) this.slot.activateRoute(last, this.slot.projectId);
  }
}

const routed = new WeakMap<ThreadSlot, TestRoute>();

export function routeOf(slot: ThreadSlot): TestRoute {
  const route = routed.get(slot);
  if (route === undefined) throw new Error('This test slot was given its own writer.');
  return route;
}

export function commitRoute(slot: ThreadSlot): void {
  routeOf(slot).commit();
}

export function testThreadChat(port: TestConnection<WireThread> = new TestConnection<WireThread>()): ThreadChat {
  const made = Effect.gen(function* () {
    const pending = yield* PendingTurns.make(new MemoryShelf());
    return { pending, stops: yield* ThreadStops.make(pending) };
  }).pipe(Effect.provideService(ChatConnection<ChatThreadView>(), port), EffectScope.provide(EffectScope.makeUnsafe()));
  return { port, ...Effect.runSync(made), shaping: new TurnShaping(), detached: new DetachedSessions<WireThread>() };
}

function emptySkills(projectId: number, scope: Scope): SkillCatalog {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  scope.defer(() => {
    queryClient.clear();
  });
  const catalogs = keyed<SkillCatalogKey, AgentSkillCatalog>({
    name: 'test-skills',
    scope,
    queryClient,
    loader: async () => {
      throw new Error('This test named no skill catalog.');
    },
  });
  return new SkillCatalog(catalogs, projectId, scope);
}

export function feedSnapshot(thread: { readonly id: string }, activeRunId: string | null = null, modes?: unknown, seq = 1) {
  const run =
    activeRunId === null
      ? null
      : { id: activeRunId, progress: { stage: 'streaming', message: null }, startedAt: '2026-09-23T12:00:00.000Z' };
  return {
    type: 'snapshot',
    at: { position: 0, seq },
    payload: {
      status: 'loaded',
      snapshot: {
        thread: { capabilities: NATIVE_CAPABILITIES, ...thread },
        modes,
        transcript: [],
        before: null,
        open: [],
        progress: null,
        activeRun: run,
        latestRun: null,
        pendingInput: { queued: [], steers: [] },
        status: {
          threadId: thread.id,
          runId: activeRunId,
          life: activeRunId === null ? 'idle' : 'working',
          stage: null,
          openQuestions: [],
          since: null,
          receipts: [],
        },
        now: '2026-09-23T12:00:00.000Z',
      },
    },
  } as never;
}
