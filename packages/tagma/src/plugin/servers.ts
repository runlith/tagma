import type { ExternalOperations } from './operations.generated.js';
import type { TagmaClient } from './plugin.js';

type ServerToolResult = ExternalOperations['call_contributed_tool']['answer']['result'];

export type ServerClient = {
  readonly call: (tool: string, input?: Readonly<Record<string, unknown>>) => Promise<ServerToolResult>;
};

export type PluginServers = { readonly in: (project: number) => PluginServers } & { readonly [name: string]: ServerClient };

export const serversClient = (tagma: TagmaClient): PluginServers =>
  new Proxy({} as PluginServers, {
    get: (_, name) => {
      if (typeof name !== 'string') return undefined;
      if (name === 'in') return (project: number) => serversClient(tagma.in(project));
      return {
        call: async (tool: string, input: Readonly<Record<string, unknown>> = {}) =>
          (await tagma.op('call_contributed_tool', { server: name, tool, arguments: input })).result,
      } satisfies ServerClient;
    },
  });
