import type { AgentPreviewInput, AgentSave, AgentSkillAim } from '@tagma/server/threads/contract/wire/agentLibrary';
import { ThreadId } from '@tagma/server/platform/contract/wire/thread';
import { Repo } from '@runlith/query/repo';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Door } from '$lib/wire/Door.js';

export type SkillCatalogKey = { readonly projectId: number; readonly aim: AgentSkillAim; readonly runId: string | null };

export const AgentLibraryRepo = Repo.define(
  'agent-library',
  ({ keyed, mutation }) => ({
    skills: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<SkillCatalogKey>, door) => {
        const aim: AgentSkillAim =
          key.aim.kind === 'thread'
            ? { kind: 'thread', id: key.aim.id }
            : key.aim.type === undefined
              ? { kind: 'draft' }
              : { kind: 'draft', type: key.aim.type };
        const { status: _, ...catalog } = await door.perform('read_agent_skills', aim, { project: String(key.projectId) }, { signal });
        return catalog;
      },
    }),
    list: mutation({
      mutator: async (projectId: number, { signal }, door) => {
        const { status: _, ...catalog } = await door.perform('read_agent_library', {}, { project: String(projectId) }, { signal });
        return catalog;
      },
    }),
    preview: mutation({
      mutator: async (input: { projectId: number; definition: AgentPreviewInput }, { signal }, door) => {
        const { status: _, ...preview } = await door.perform(
          'read_agent',
          input.definition,
          { project: String(input.projectId) },
          { signal },
        );
        return preview;
      },
    }),
    thread: mutation({
      mutator: async (input: { projectId: number; threadId: string }, { signal }, door) => {
        const { status: _, ...preview } = await door.perform(
          'read_thread_agent',
          { threadId: ThreadId.make(input.threadId) },
          { project: String(input.projectId) },
          { signal },
        );
        return preview;
      },
    }),
    save: mutation({
      mutator: async (input: { projectId: number; definition: AgentSave }, { signal }, door) => {
        const { status: _, ...definition } = await door.perform(
          'save_agent',
          input.definition,
          { project: String(input.projectId) },
          { signal },
        );
        return definition;
      },
    }),
  }),
  { tier: 'app', door: Door },
);
