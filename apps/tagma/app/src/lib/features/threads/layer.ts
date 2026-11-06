import { Layer } from '@runlith/layer/Layer';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { AgentsColumn } from './AgentsColumn.svelte.js';
import { ArchivedThreadsOpen } from './ArchivedThreadsOpen.svelte.js';
import { CallActivity } from './CallActivity.svelte.js';
import { ContextPanelState } from './native/PanelState.svelte.js';
import { DraftShelf } from './native/DraftShelf.svelte.js';
import { ThreadContributions } from './native/layer.js';
import { PageDraft } from './PageDraft.js';
import { ThreadChats } from './ThreadChats.js';
import { ViewRepairs } from '$lib/features/plugin-views/Repairs.js';
import { Asking } from './Asking.js';
import { ThreadPreferences } from './native/preferences.js';
import { SurfaceChoices } from './external/Surface.svelte.js';
import { ThreadEffects } from './thread/ThreadEffects.js';
import { ThreadFeed } from './thread/ThreadFeed.svelte.js';
import { ThreadSettings } from './thread/ThreadSettings.svelte.js';
import { ThreadAuthority } from './thread/ThreadAuthority.svelte.js';
import { ThreadCompaction } from './thread/ThreadCompaction.svelte.js';
import { ThreadRecap } from './thread/ThreadRecap.svelte.js';
import { ThreadInstructions } from './thread/ThreadInstructions.js';
import { ThreadComposition } from './thread/ThreadComposition.svelte.js';
import { ThreadPlace } from './thread/ThreadPlace.svelte.js';
import { ThreadContext } from './thread/ThreadContext.svelte.js';
import { AgentLibraryOverlay } from './overlay.js';
import { AgentLibraryRepo } from './library/AgentLibraryRepo.js';
import { AgentTypes } from './AgentTypes.svelte.js';
import { Favorites } from './Favorites.svelte.js';
import { ModelDefaults } from './ModelDefaults.svelte.js';
import { ThreadFolds } from './threadFolds.svelte.js';
import { ThreadList } from './List.svelte.js';
import { FolderActs } from './FolderActs.js';
import { MentionDrops } from './MentionDrops.svelte.js';
import { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import { ThreadRungSource } from '$lib/features/workspace/ThreadRung.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { ThreadWords } from './Words.svelte.js';
import { WorkLines } from './workLines.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { ThreadSeats } from './seats/ThreadSeats.svelte.js';
import { TeamRepo } from './team/TeamRepo.js';
import { ThreadTeam } from './team/ThreadTeam.svelte.js';
import { LinkKinds, LinkMenuItems } from '$lib/features/opening/Link.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { Actions } from '$lib/features/workspace/action.js';
import { Columns } from '$lib/features/workspace/column.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { StagedKinds } from '$lib/shared/threads/staged.js';
import { Staging } from './staging.js';
import { actions } from './actions.js';
import { columns } from './columns.js';
import { items, links } from './links.js';
import { panes } from './panes.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const HarnessLayer = Layer.mergeAll(
  Surfaces.contribute('threads', ...surfaces),
  Panes.contribute('threads', ...panes),
  Columns.contribute('threads', ...columns),
  SettingSections.contribute('threads', ...sections),
  LinkKinds.contribute('threads', ...links),
  LinkMenuItems.contribute('threads', ...items),
  Actions.contribute('threads', { id: 'threads', area: 'Agents', actions }),
  ThreadSeats,
  AgentsColumn,
  ThreadsRepo,
  TeamRepo,
  AgentLibraryRepo,
  AgentTypes,
  ModelDefaults,
  Favorites,
  AgentLibraryOverlay.presentLazy(() => import('./library/AgentLibrary.svelte')),
  ThreadChats,
  Asking,
  ThreadPreferences,
  SurfaceChoices,
  ThreadEffects,
  ThreadFeed,
  ThreadSettings,
  ThreadAuthority,
  ThreadTeam,
  ThreadCompaction,
  ThreadRecap,
  ThreadInstructions,
  ThreadComposition,
  ThreadPlace,
  ThreadContext,
  CallActivity,
  StagedKinds,
  Staging,
  DraftShelf,
  PageDraft,
  ThreadList,
  FolderActs,
  ThreadPresence,
  WorkLines,
  Layer.provide(ThreadNames, function* () {
    const threads = yield* ThreadList;
    const words = new ThreadWords(threads, yield* ThreadsRepo, yield* Workspace, (yield* ProjectRung.Current).projectId);
    return new ThreadNames(
      (thread, project) => words.of(thread, project),
      (thread) => words.read(thread),
    );
  }),
  Layer.provide(ViewRepairs, function* () {
    const asking = yield* Asking;
    return { fix: (projectId: number, request: string) => asking.ask({ projectId }, request) };
  }),
  ThreadFolds,
  ContextPanelState,
  ArchivedThreadsOpen,
  MentionDrops,
  ThreadRungSource,
  ThreadContributions,
);
