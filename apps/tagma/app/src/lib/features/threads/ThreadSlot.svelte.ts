import { Effect, type Exit } from 'effect';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import type { CompactionChoice } from '@tagma/server/native-harness/contract/wire/compactionChoices';
import type { ChatContextSource } from '@runlith/chat-ui/contextUsage';
import type { ChatNotice } from '@runlith/chat-ui/notice';
import { type ComposerHandler, settled } from '@runlith/chat-ui/composer';
import { PromptHistory } from '@runlith/chat-ui/PromptHistory';
import type { ChatTurnFailure } from '@runlith/chat-ui/session/TurnCommands.svelte';
import type { ThreadSession } from '@runlith/chat-ui/session/ThreadSession.svelte';
import type { MountedApp } from '@runlith/layer/App';
import { Platform } from '@runlith/layer/Platform';
import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import { ChatHold } from './ChatHold.svelte.js';
import { AgentTypes } from './AgentTypes.svelte.js';
import { ThreadBirth } from './birth/ThreadBirth.svelte.js';
import { type Draft, type DraftPlace, MAIN_CHECKOUT, ThreadDraft } from './Draft.svelte.js';
import { ModelDefaults } from './ModelDefaults.svelte.js';
import { Favorites } from './Favorites.svelte.js';
import { AgentLibraryRepo } from './library/AgentLibraryRepo.js';
import { type ThreadIdentity, ThreadList } from './List.svelte.js';
import { ComposerFeeds } from './native/ComposerFeeds.svelte.js';
import { DraftShelf } from './native/DraftShelf.svelte.js';
import { type ProductRecord, ProductRecords, recordOf } from './native/records.js';
import type { Point } from '@runlith/layer/Point';
import { pickedSummarizer } from './native/compactionWords.js';
import { PromptStore } from './native/PromptStore.js';
import { type StagedKind, StagedKinds } from '$lib/shared/threads/staged.js';
import { StagedItems } from './native/StagedItems.js';
import { ThreadUploads, attachmentHandlers } from './native/ThreadUploads.js';
import { Door } from '$lib/wire/Door.js';
import { SkillCatalog } from './native/SkillCatalog.svelte.js';
import { chatNotice } from './notices.js';
import { type HarnessOpenAttempt, ThreadOpenWatch, type ThreadOpenAttempt } from './OpenWatch.js';
import { Runner } from './Runner.js';
import { SurfaceChoices, ThreadSurface } from './external/Surface.svelte.js';
import { ModelPanelState } from './ModelPanelState.svelte.js';
import { ShownThread } from './ShownThread.js';
import { type SlotNavigation, ThreadWrites } from './ThreadWrites.js';
import { ThreadViews } from './thread/ThreadViews.js';
import { SlotSelection, type SlotContext, type SlotWriter } from './SlotSelection.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { TeamRepo } from './team/TeamRepo.js';
import { type ThreadChat, ThreadChats } from './ThreadChats.js';
import { type AuthorityView, type DelegationPick } from './thread/authority.js';
import { contextLabelsOf, type ContextLabels, type ModelView } from './thread/modelSettings.js';
import { asHandler } from './thread/ThreadRefused.js';
import { ThreadAuthority } from './thread/ThreadAuthority.svelte.js';
import { ThreadCompaction } from './thread/ThreadCompaction.svelte.js';
import { ThreadContext } from './thread/ThreadContext.svelte.js';
import { ThreadFeed } from './thread/ThreadFeed.svelte.js';
import { ThreadInstructions } from './thread/ThreadInstructions.js';
import { ThreadLease } from './thread/ThreadLease.js';
import { ThreadRecap } from './thread/ThreadRecap.svelte.js';
import { ThreadSettings } from './thread/ThreadSettings.svelte.js';

const NO_CONTEXT: SlotContext = { scopeName: () => null };

export type SlotOptions = { readonly pane?: string };

export type SlotArgs = SlotOptions & {
  readonly app: MountedApp;
  readonly writer: SlotWriter;
  readonly context?: SlotContext;
};

export class ThreadSlot extends Process<ThreadSlot, SlotArgs>()('ThreadSlot', { tier: 'project' }) implements SlotNavigation {
  readonly draft: ThreadDraft;
  readonly chat: ChatHold;
  readonly history: PromptHistory;
  readonly surface: ThreadSurface;
  readonly birth: ThreadBirth;
  readonly feeds: ComposerFeeds;

  readonly shown: ShownThread;
  readonly views: ThreadViews;
  readonly writes: ThreadWrites;
  readonly panel = new ModelPanelState();

  thread = $state.raw<ThreadLease | null>(null);
  harnessOpen = $state<HarnessOpenAttempt | null>(null);

  private readonly selection: SlotSelection;
  private readonly writer: SlotWriter;
  private readonly opens: ThreadOpenWatch;

  static override *make({ app, writer, context, ...options }: SlotArgs) {
    const projectId = (yield* ProjectRung.Current).projectId;
    const library = yield* AgentLibraryRepo;
    const scope = yield* Scope;
    const threads = yield* ThreadsRepo;
    return new ThreadSlot(
      projectId,
      (yield* ThreadChats).of(projectId),
      yield* DraftShelf,
      threads,
      yield* ThreadList,
      yield* Worktrees,
      yield* AgentTypes,
      yield* ModelDefaults,
      yield* UsageAccounts,
      yield* Favorites,
      yield* ProviderCatalog,
      yield* SelectionRepo,
      yield* TagCatalog,
      yield* SettingsRepo,
      yield* SurfaceChoices,
      yield* TeamRepo,
      yield* Notices,
      new SkillCatalog(library.skills, projectId, scope),
      yield* Door,
      yield* ProductRecords,
      yield* StagedKinds,
      (yield* Platform).storage.local,
      scope,
      app,
      new Runner(),
      writer,
      context ?? NO_CONTEXT,
      options,
    );
  }

  constructor(
    readonly projectId: number,
    chats: ThreadChat,
    private readonly shelf: DraftShelf,
    threads: ThreadsRepo,
    private readonly list: ThreadList,
    readonly places: Worktrees,
    types: AgentTypes,
    defaults: ModelDefaults,
    accounts: UsageAccounts,
    favorites: Favorites,
    private readonly catalog: ProviderCatalog,
    selection: SelectionRepo,
    tags: TagCatalog,
    settings: SettingsRepo,
    choices: SurfaceChoices,
    teams: TeamRepo,
    notices: Notices,
    readonly skills: SkillCatalog,
    door: Door,
    records: Point<ProductRecord>,
    kinds: Point<StagedKind>,
    storage: ConstructorParameters<typeof PromptStore>[0],
    private readonly scope: Scope,
    private readonly app: MountedApp,
    private readonly runner: Runner,
    writer: SlotWriter,
    context: SlotContext,
    options: SlotOptions = {},
  ) {
    super();
    this.selection = new SlotSelection(projectId, options.pane);
    this.writer = writer;
    this.opens = new ThreadOpenWatch(runner, (threadId) => this.showing(threadId));
    this.draft = new ThreadDraft(shelf, new ThreadUploads(threads, door, projectId), new StagedItems(kinds, app, projectId), () =>
      list.titles(),
    );
    this.draft.useKey(this.selection.draftKey(null));
    this.history = new PromptHistory(new PromptStore(storage, projectId));
    this.surface = new ThreadSurface(projectId, () => this.chat.session?.thread ?? null, choices);
    this.feeds = new ComposerFeeds(this.draft, selection, tags, projectId, () => this.chat.commands.dismiss());
    this.chat = new ChatHold(
      chats,
      runner,
      this.draft,
      (hold) =>
        new ThreadBirth(
          hold,
          this.selection,
          this.writer,
          context,
          scope,
          this.draft,
          shelf,
          threads,
          projectId,
          list,
          places,
          types,
          settings,
          defaults,
          accounts,
          favorites,
          catalog,
          teams,
          notices,
          () => this.restart(),
        ),
      (failure) => this.noticeOf(failure),
      this.history,
      { ...attachmentHandlers(door, projectId), transcriptEntry: (raw) => recordOf(records, raw) },
    );
    this.birth = this.chat.birth;
    this.shown = new ShownThread(
      projectId,
      () => this.selection.activeId,
      () => this.thread,
      () => this.identity,
      () => this.row,
    );
    this.views = new ThreadViews(this.shown, this.birth);
    this.writes = new ThreadWrites(this.shown, this.chat, chats.shaping, this.birth, this.views, skills, runner, this);
    scope.defer(() => {
      this.opens.abandon('closed');
      this.thread?.release();
      return runner.close();
    });
  }

  get activeId(): string | null {
    return this.selection.activeId;
  }

  activeThread = $derived.by<WireThread | null>(() => this.thread?.get(ThreadFeed).chatThread ?? null);
  canSend = $derived.by(() => this.chat.commands.canSend);

  row = $derived.by<ThreadListRow | null>(() => this.list.harnessRow(this.selection.activeId));

  place = $derived.by<WorktreePlace | null>(() => {
    const id = this.selection.activeId;
    if (id === null) return this.birth.place.row;
    return this.places.known ? this.places.placeOf(id) : null;
  });

  identity = $derived.by<ThreadIdentity | null>(() =>
    this.list.identityOf(this.selection.activeId, this.thread?.get(ThreadFeed).session.thread ?? null),
  );

  forget(id: string): void {
    this.shelf.forget(this.selection.draftKey(id));
    if (this.selection.activeId === id) this.showDraft();
  }

  activateRoute(sessionId: string | null, projectId: number | null): void {
    if (projectId !== this.projectId) return;
    if (sessionId === this.selection.activeId) {
      if (sessionId !== null) this.opens.standing();
      return;
    }
    if (sessionId === null) {
      this.resetDraft();
      return;
    }
    this.select(sessionId);
  }

  open(id: string): void {
    if (this.selection.activeId === id) {
      this.opens.standing();
      return;
    }
    this.writer.open(id);
  }

  startDraft(place: DraftPlace = MAIN_CHECKOUT): void {
    this.shelf.place(this.selection.draftKey(null), place, () => this.list.titles());
    this.showDraft();
  }

  startDraftAs(type: string): void {
    const unborn = this.selection.draftKey(null);
    this.shelf.at(unborn, () => this.list.titles()).type = type;
    this.shelf.keep(unborn);
    this.startDraft();
  }

  handDraft(to: string): void {
    const from = this.selection.draftKey(null);
    const place = this.shelf.at(from).place;
    void this.shelf.carry(from, to).then(() => this.shelf.place(to, place));
  }

  showDraft(): void {
    if (this.selection.activeId === null) this.resetDraft();
    this.writer.navigate(null);
  }

  rehome(projectId: number): void {
    if (projectId === this.projectId || this.selection.activeId !== null) return;
    void this.shelf.carry(this.selection.draftKey(null), this.selection.draftKeyIn(projectId));
    this.writer.rehome(projectId);
  }

  private restart(): void {
    this.showDraft();
    void this.writes.send();
  }

  private resetDraft(): void {
    this.chat.commands.dismiss();
    this.select(null);
  }

  private noticeOf(failure: ChatTurnFailure<Draft>): ChatNotice | null {
    if (this.thread?.find(ThreadCompaction)?.absorbs(failure) === true) return null;
    return chatNotice(failure);
  }

  private select(id: string | null): void {
    this.opens.select(id);
    this.harnessOpen = null;
    this.panel.close();
    this.bind(id);
  }

  private lease(id: string | null): void {
    if (id !== null && this.thread?.threadId === id) return;
    this.thread?.release();
    this.thread = id === null ? null : new ThreadLease(this.app, id, this.scope);
    this.chat.show(this.thread === null ? null : this.thread.get(ThreadFeed).session);
  }

  private bind(id: string | null): void {
    this.selection.select(id);
    this.draft.useKey(this.selection.draftKey(id));
    void this.draft.lostNotice().then((message) => {
      if (message !== null && !this.scope.signal.aborted) this.chat.commands.say({ tone: 'error', message });
    });
    const attempt = this.opens.inFlight;
    this.opens.subscribing(() => this.lease(id));
    const session = this.chat.session;
    if (session === null) return;
    void this.chat.run(session.opened(), false).then((read) => this.opened(session, read, attempt));
  }

  private opened(session: ThreadSession<WireThread>, read: boolean, attempt: ThreadOpenAttempt | null): void {
    if (this.chat.session !== session) return;
    if (!read) {
      if (attempt !== null && this.opens.inFlight === attempt) this.opens.abandon('unreadable');
      return;
    }
    if (this.surface.kind === 'terminal') {
      this.harnessOpen ??= this.opens.toHarness();
      return;
    }
    this.harnessOpen = null;
    const timed = this.opens.arrived(attempt);
    if (timed !== null) this.opens.applied(timed, session.fold.entries.length);
  }

  private showing(threadId: string): boolean {
    if (this.scope.signal.aborted || this.selection.activeId !== threadId) return false;
    const session = this.chat.session;
    return session?.threadId === threadId && session.threadPhase.kind === 'open';
  }
}
