export type McpCaller =
  | {
      readonly kind: 'agent';
      readonly projectId: number | null;
      readonly agentId: string;
      readonly ownerId: string;
      readonly thread: {
        readonly threadId: string;
        readonly runId: string;
        readonly bindings: Readonly<Record<string, string>>;
      } | null;
    }
  | {
      readonly kind: 'operator';
      readonly projectId: number | null;
      readonly view: string;
      readonly threadId?: string;
      readonly bindings?: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'tagma';
      readonly projectId: number | null;
      readonly reason: string;
    };

export const MCP_CALLER_META_KEY = 'runlith/caller';

export function mcpCallerMeta(caller: McpCaller): Readonly<Record<string, McpCaller>> {
  return { [MCP_CALLER_META_KEY]: caller };
}
