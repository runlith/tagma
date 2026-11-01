import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { ThreadSelectionQuery } from '@tagma/server/threads/contract/wire/selection';
import type { FavoriteModels, ModelDefaults, ModelDefaultsWrite } from '@tagma/server/native-harness/contract/wire/modelSelection';
import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import type { HarnessTransport } from '@tagma/server/threads/contract/wire/harness/names';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import type { NameProvenance } from '@tagma/server/thread-record/contract/wire/name';
import type { ThreadRewindScope } from '@runlith/agent/transcript/eventFold';
import type { InstanceOf } from '@runlith/layer/key';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

function at(projectId: number): { project: string } {
  return { project: String(projectId) };
}

export type AskedAction = {
  readonly id: string;
  readonly meaning: string;
  readonly asksFrom: string;
  readonly conditions: readonly { readonly id: string; readonly label: string; readonly asksFrom: string }[];
};

export const ARCHIVED_PAGE = 50;
const FAMILY_PAGE = 50;
export const CONVERSATION_AROUND = 3;
//! A filter list is scanned, not paged: past twenty hits the reader narrows the query, and the count says there are more.
export const CONVERSATION_HITS_SHOWN = 20;

type Bare<Answer> = Answer extends unknown ? Omit<Answer, 'status'> : never;

const bare = <Answer extends { readonly status: string }>({ status: _status, ...rest }: Answer): Bare<Answer> => rest as Bare<Answer>;

export const ThreadsRepo = Repo.define(
  'threads',
  ({ single, keyed, mutation }) => ({
    list: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<{ project: string | null; selection?: ThreadSelectionQuery }>, door) => {
        const selection = key.selection ?? {};
        const { ids, limit, before, set, state, of, reach, models, providers, title, ...clocks } = selection;
        return door.perform(
          'list_threads',
          {
            ...clocks,
            title,
            set: set === undefined ? undefined : (set as 'live' | 'archived' | 'all'),
            state: state === undefined ? undefined : (state as 'running' | 'stalled'),
            of: of === undefined ? undefined : ThreadId.make(of),
            reach: reach === undefined ? undefined : (reach as 'children' | 'descendants' | 'tree'),
            models: models === undefined ? undefined : models.split(','),
            providers: providers === undefined ? undefined : providers.split(','),
            ids: ids === undefined ? undefined : ids.split(',').map((id) => ThreadId.make(id)),
            limit: limit === undefined ? undefined : Number(limit),
            cursor: before,
            shape: 'rows',
          },
          key.project === null ? {} : { project: key.project },
          { signal },
        );
      },
    }),

    roots: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<{ projectId: number; readerBefore?: string }>, door) =>
        door
          .perform('list_thread_window', key.readerBefore === undefined ? {} : { readerBefore: key.readerBefore }, at(key.projectId), {
            signal,
          })
          .then(bare),
    }),

    archived: keyed({
      loader: ({ key, signal }: KeyedLoaderContext<number>, door) =>
        door.perform('list_threads', { set: 'archived', limit: ARCHIVED_PAGE, shape: 'rows' }, at(key), { signal }),
    }),

    family: keyed({
      gcTime: 0,
      loader: async ({ key, signal }: KeyedLoaderContext<string>, door): Promise<readonly ThreadListRow[]> => {
        const rows: ThreadListRow[] = [];
        let cursor: string | undefined;
        do {
          const page = await door.perform(
            'list_threads',
            { of: ThreadId.make(key), reach: 'tree', set: 'all', limit: FAMILY_PAGE, cursor, shape: 'rows' },
            {},
            { signal },
          );
          if (page.status !== 'rows') throw new Error('a thread family answered without rows');
          rows.push(...page.rows);
          cursor = page.before ?? undefined;
        } while (cursor !== undefined);
        return rows;
      },
    }),

    askedActions: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number>, door) => {
        const rows: AskedAction[] = [];
        let cursor: string | undefined;
        do {
          const answer = await door.perform('read_operations', cursor === undefined ? {} : { cursor }, at(key), { signal });
          for (const row of answer.operations.rows) {
            rows.push({ id: row.id, meaning: row.meaning, asksFrom: row.approval.asksFrom, conditions: row.approval.conditions });
          }
          cursor = answer.operations.next ?? undefined;
        } while (cursor !== undefined);
        return rows;
      },
    }),

    conversations: keyed({
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: ({ key, signal }: KeyedLoaderContext<{ projectId: number; query: string }>, door) =>
        door
          .perform('search_threads', { query: key.query, projects: 'all', limit: CONVERSATION_HITS_SHOWN }, at(key.projectId), { signal })
          .then(bare),
    }),

    conversationWindow: keyed({
      gcTime: 0,
      refetchOnWindowFocus: false,
      loader: ({ key, signal }: KeyedLoaderContext<{ projectId: number; threadId: string; entryId: string }>, door) =>
        door
          .perform(
            'read_thread_record',
            { threadId: ThreadId.make(key.threadId), at: [{ at: key.entryId }], conversation: true, around: CONVERSATION_AROUND },
            at(key.projectId),
            { signal },
          )
          .then((answer) => (answer.status === 'conversation' ? answer.windows : [])),
    }),

    defaults: single({
      loader: async ({ signal }, door): Promise<ModelDefaults> => {
        const answer = await door.perform('read_model_defaults', {}, {}, { signal });
        if (answer.status === 'unconnected') return { status: 'unconnected' as const, plans: answer.plans };
        const { status: _, remembered, ...defaults } = answer;
        return { status: 'read' as const, defaults, remembered };
      },
    }),

    setDefaults: mutation({
      mutator: async (selection: ModelDefaultsWrite, { signal }, door) => {
        const { status: _, ...defaults } = await door.perform(
          'set_model_defaults',
          {
            account: selection.account ?? null,
            provider: selection.provider,
            model: selection.model,
            reasoning: selection.reasoning ?? null,
            switches: selection.switches,
          },
          {},
          { signal },
        );
        return defaults;
      },
    }),

    favorites: single({
      loader: async ({ signal }, door) => {
        const { status: _, ...favorites } = await door.perform('read_model_favorites', {}, {}, { signal });
        return favorites;
      },
    }),

    setFavorites: mutation({
      mutator: async (favorites: FavoriteModels, { signal }, door) => {
        const { status: _, ...saved } = await door.perform('set_model_favorites', favorites, {}, { signal });
        return saved;
      },
    }),

    setArchived: mutation({
      mutator: (input: { id: string; projectId: number; archived: boolean }, { signal }, door) =>
        door.perform('archive_thread', { threadId: ThreadId.make(input.id), archived: input.archived }, at(input.projectId), { signal }),
    }),

    setPinned: mutation({
      mutator: (input: { id: string; projectId: number; pinned: boolean }, { signal }, door) =>
        door.perform('pin_thread', { threadId: ThreadId.make(input.id), pinned: input.pinned }, at(input.projectId), { signal }),
    }),

    detach: mutation({
      mutator: (input: { id: string; projectId: number; detached: boolean }, { signal }, door) =>
        door.perform('detach_thread', { threadId: ThreadId.make(input.id), detached: input.detached }, at(input.projectId), { signal }),
    }),

    file: mutation({
      mutator: (input: { projectId: number; threadIds: readonly string[]; folderId: string | null }, { signal }, door) =>
        door
          .perform(
            'file_threads',
            { threadIds: input.threadIds.map((id) => ThreadId.make(id)), folderId: input.folderId },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    createFolder: mutation({
      mutator: (input: { projectId: number; name: string; parentId: string | null; threadIds: readonly string[] }, { signal }, door) =>
        door
          .perform(
            'create_thread_folder',
            { name: input.name, parentId: input.parentId, threadIds: input.threadIds.map((id) => ThreadId.make(id)) },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    renameFolder: mutation({
      mutator: (input: { projectId: number; folderId: string; name: string }, { signal }, door) =>
        door.perform('rename_thread_folder', { folderId: input.folderId, name: input.name }, at(input.projectId), { signal }).then(bare),
    }),

    moveFolder: mutation({
      mutator: (input: { projectId: number; folderId: string; parentId: string | null; index: number }, { signal }, door) =>
        door
          .perform('move_thread_folder', { folderId: input.folderId, parentId: input.parentId, index: input.index }, at(input.projectId), {
            signal,
          })
          .then(bare),
    }),

    deleteFolder: mutation({
      mutator: (input: { projectId: number; folderId: string }, { signal }, door) =>
        door.perform('delete_thread_folder', { folderId: input.folderId }, at(input.projectId), { signal }).then(bare),
    }),

    setDelegation: mutation({
      mutator: async (input: { id: string; projectId: number; delegation: boolean | null }, { signal }, door) => {
        const switched = await door.perform(
          'set_thread_delegation',
          { threadId: ThreadId.make(input.id), delegation: input.delegation },
          at(input.projectId),
          { signal },
        );
        return { threadId: switched.threadId, own: switched.own, allowed: switched.delegation === 'on', setAt: switched.setAt };
      },
    }),

    setApprover: mutation({
      mutator: async (input: { id: string; projectId: number; approver: 'you' | 'default' }, { signal }, door) =>
        door.perform('set_thread_approver', { threadId: ThreadId.make(input.id), approver: input.approver }, at(input.projectId), {
          signal,
        }),
    }),

    setApproves: mutation({
      mutator: async (input: { id: string; projectId: number; approves: readonly string[] | null }, { signal }, door) =>
        door.perform('set_thread_approves', { threadId: ThreadId.make(input.id), approves: input.approves }, at(input.projectId), {
          signal,
        }),
    }),

    setTransport: mutation({
      mutator: (input: { id: string; projectId: number; transport: HarnessTransport }, { signal }, door) =>
        door
          .perform('set_thread_transport', { threadId: ThreadId.make(input.id), transport: input.transport }, at(input.projectId), {
            signal,
          })
          .then(bare),
    }),

    create: mutation({
      mutator: (
        input: {
          projectId: number;
          payload:
            | {
                title?: string;
                name?: string;
                type?: string;
                scopeName?: string;
                account?: string;
                switches?: Readonly<Record<string, string>>;
                delegation?: boolean;
                team?: TeamLayer;
                approvalMode?: AgentApprovalMode;
                nameOrigin?: NameProvenance;
                worktree?: string;
                base?: string;
                worktreeName?: string;
              }
            | { name?: string; type?: string; parent: string; task: string };
        },
        { signal },
        door,
      ) => door.perform('create_thread', input.payload, at(input.projectId), { signal }).then(bare),
    }),

    snapshot: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('read_thread_snapshot', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }),
    }),

    types: mutation({
      mutator: (input: { projectId: number; rescan?: boolean }, { signal }, door) =>
        door.perform('list_thread_types', { refresh: input.rescan }, at(input.projectId), { signal }).then(bare),
    }),

    composition: mutation({
      mutator: async (input: { id: string; projectId: number }, { signal }, door) => {
        const { status: _, ...reading } = await door.perform(
          'read_thread_composition',
          { threadId: ThreadId.make(input.id) },
          at(input.projectId),
          { signal },
        );
        return reading;
      },
    }),

    compactionChoices: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('read_compaction_choices', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }).then((answer) => {
          const { status: _, ...read } = answer;
          return read;
        }),
    }),

    see: mutation({
      mutator: (input: { id: string; projectId: number; runId: string }, { signal }, door) =>
        door
          .perform('mark_thread_seen', { threadId: ThreadId.make(input.id), runId: input.runId }, at(input.projectId), { signal })
          .then((answer) => bare(answer)),
    }),

    setTitle: mutation({
      mutator: (input: { id: string; projectId: number; title: string }, { signal }, door) =>
        door
          .perform('set_thread_title', { threadId: ThreadId.make(input.id), title: input.title }, at(input.projectId), { signal })
          .then((answer) => bare(answer)),
    }),

    generateTitle: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('generate_thread_title', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }),
    }),

    refreshInstructions: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('refresh_thread_instructions', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }),
    }),

    generateRecap: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('generate_thread_recap', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }),
    }),

    restart: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('restart_thread', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }).then(bare),
    }),

    remove: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('delete_thread', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }),
    }),

    rewindPoints: mutation({
      mutator: (input: { id: string; projectId: number }, { signal }, door) =>
        door.perform('read_rewind_points', { threadId: ThreadId.make(input.id) }, at(input.projectId), { signal }).then(bare),
    }),

    previewRewind: mutation({
      mutator: (input: { id: string; projectId: number; at: string; scope: ThreadRewindScope }, { signal }, door) =>
        door
          .perform('read_rewind', { threadId: ThreadId.make(input.id), at: input.at, scope: input.scope }, at(input.projectId), { signal })
          .then(bare),
    }),

    rewind: mutation({
      mutator: (
        input: { id: string; projectId: number; at: string; scope: ThreadRewindScope; revertLines: boolean; key: string },
        { signal },
        door,
      ) =>
        door
          .perform(
            'rewind_thread',
            { threadId: ThreadId.make(input.id), at: input.at, scope: input.scope, revertLines: input.revertLines, key: input.key },
            at(input.projectId),
            { signal },
          )
          .then(bare),
    }),

    restore: mutation({
      mutator: (input: { id: string; projectId: number; rewindId: string; key: string }, { signal }, door) =>
        door
          .perform('restore_thread', { threadId: ThreadId.make(input.id), rewindId: input.rewindId, key: input.key }, at(input.projectId), {
            signal,
          })
          .then(bare),
    }),

    branch: mutation({
      mutator: (input: { id: string; projectId: number; before?: string; key: string }, { signal }, door) =>
        door
          .perform('branch_thread', { threadId: ThreadId.make(input.id), before: input.before, key: input.key }, at(input.projectId), {
            signal,
          })
          .then(bare),
    }),

    upload: mutation({
      mutator: (input: { id: string; projectId: number; mediaType: string; bytes: Uint8Array; name?: string }, { signal }, door) =>
        door.ask(
          (api) =>
            api.threads.upload({
              params: { id: input.id },
              query: { ...at(input.projectId), name: input.name },
              headers: { 'content-type': input.mediaType },
              payload: input.bytes,
            }),
          { signal },
        ),
    }),
    drop: mutation({
      mutator: async (input: { id: string; projectId: number; file: File }, { signal }, door) => {
        const payload = new Uint8Array(await input.file.arrayBuffer());
        return door.ask(
          (api) =>
            api.threads.drop({
              params: { id: input.id },
              query: { ...at(input.projectId), name: input.file.name === '' ? undefined : input.file.name },
              payload,
            }),
          { signal },
        );
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type ThreadsRepo = InstanceOf<typeof ThreadsRepo>;
