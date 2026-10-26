import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { McpHttpServerDeclaration, McpStdioServerDeclaration } from '@runlith/mcp/declaration';
import type { KeyedLoaderContext } from '@runlith/query/types';
import { Repo } from '@runlith/query/repo';
import { Door, type Lens } from '$lib/wire/Door.js';

export type McpDeclarationInput =
  | (Omit<McpStdioServerDeclaration, 'enabled'> & { readonly enabled?: boolean })
  | (Omit<McpHttpServerDeclaration, 'enabled'> & { readonly enabled?: boolean });

const lens = (projectId: number | undefined): Lens => (projectId === undefined ? {} : { project: String(projectId) });

export const McpRepo = Repo.define(
  'mcp',
  ({ keyed, mutation }) => ({
    servers: keyed({
      loader: async ({ key, signal }: KeyedLoaderContext<number | undefined>, door) =>
        (await door.perform('read_mcp_servers', {}, lens(key), { signal })).mcp,
    }),

    add: mutation({
      mutator: async (input: { projectId?: number; scope: SettableScope; declaration: McpDeclarationInput }, { signal }, door) =>
        (await door.perform('add_mcp_server', { ...input.declaration, scope: input.scope }, lens(input.projectId), { signal })).mcp,
    }),

    setEnabled: mutation({
      mutator: async (input: { projectId?: number; scope: SettableScope; name: string; enabled: boolean }, { signal }, door) =>
        (
          await door.perform('enable_mcp_server', { name: input.name, enabled: input.enabled, scope: input.scope }, lens(input.projectId), {
            signal,
          })
        ).mcp,
    }),

    remove: mutation({
      mutator: async (input: { projectId?: number; scope: SettableScope; name: string }, { signal }, door) =>
        (await door.perform('remove_mcp_server', { name: input.name, scope: input.scope }, lens(input.projectId), { signal })).mcp,
    }),
  }),
  { tier: 'app', door: Door },
);
