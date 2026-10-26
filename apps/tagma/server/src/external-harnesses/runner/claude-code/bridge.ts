import { Deferred, Effect, Option } from 'effect';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { Relay } from '../hosted/relay.js';
import { mcpToolServer, type McpServedResult, type McpServedTool } from '@runlith/mcp/server';
import type { HostedContent, HostedToolWire } from '../../contract/wire/hosted.js';
import type { HostedDoor } from '../hosted/door.js';
import type { Handed } from '../hosted/handed.js';
import { SERVED, TAGMA_SERVER } from './names.js';

export const servedPrompt = (prompt: string): string =>
  `${prompt}\n\nThe Tagma tools in your tool list are named \`${SERVED}<name>\`, where \`<name>\` is the name these instructions give the tool.`;

const TOOL_USE_META = 'claudecode/toolUseId';

const RELIST_MS = 5_000;

const servedOf = (tool: HostedToolWire): McpServedTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: { ...tool.inputSchema, type: 'object' },
  annotations: { readOnlyHint: true, destructiveHint: tool.mutates },
});

const sameTools = (left: readonly McpServedTool[], right: readonly McpServedTool[]): boolean =>
  left.length === right.length && JSON.stringify(left) === JSON.stringify(right);

const resultOf = (content: readonly HostedContent[], failed: boolean): McpServedResult => {
  const media = content.flatMap((part) =>
    part.type === 'image' ? [{ type: 'image' as const, data: part.data, mimeType: part.mimeType }] : [],
  );
  return {
    text: content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n'),
    media: media.length === 0 ? undefined : media,
    isError: failed,
  };
};

export class Bridge {
  private served: readonly McpServedTool[];
  private readonly relisting = new Set<Deferred.Deferred<void>>();
  readonly config: McpSdkServerConfigWithInstance;
  private readonly relay: Relay;

  constructor(
    door: HostedDoor,
    handed: Handed,
    private readonly stderr: (text: string) => void,
    broke: (reason: string) => Effect.Effect<void>,
    queued: (words: readonly string[]) => Effect.Effect<void>,
  ) {
    this.served = [];
    this.relay = new Relay(door, handed, {
      changed: () => Effect.flatMap(door.tools(), (listed) => this.serve(listed.tools)),
      queued,
      stderr,
      broke,
    });
    const server = mcpToolServer({
      name: TAGMA_SERVER,
      version: '1',
      tools: () => {
        for (const listed of this.relisting) Deferred.doneUnsafe(listed, Effect.void);
        this.relisting.clear();
        return this.served;
      },
      call: (tool, input, meta, _requestId, signal) => Effect.runPromise(this.called(tool, input, meta), { signal }),
    });
    this.config = { type: 'sdk', name: TAGMA_SERVER, instance: server };
  }

  readonly serve = Effect.fnUntraced(function* (this: Bridge, tools: readonly HostedToolWire[]) {
    const listed = yield* this.offer(tools);
    if (listed === null) return;
    const heard = yield* Deferred.await(listed).pipe(Effect.timeoutOption(RELIST_MS));
    if (Option.isSome(heard)) return;
    this.relisting.delete(listed);
    this.stderr(
      `Claude Code did not list Tagma's tools again within ${RELIST_MS} ms of being told they changed; its next request may carry the previous list\n`,
    );
  });

  private readonly offer = Effect.fnUntraced(
    function* (this: Bridge, tools: readonly HostedToolWire[]) {
      const served = tools.map(servedOf);
      if (sameTools(served, this.served)) return [...this.relisting].at(-1) ?? null;
      this.served = served;
      const listed = yield* Deferred.make<void>();
      this.relisting.add(listed);
      yield* Effect.promise(() => this.config.instance.server.sendToolListChanged());
      return listed;
    },
    (work) => Effect.uninterruptible(work),
  );

  private called(tool: string, input: unknown, meta: Readonly<Record<string, unknown>>): Effect.Effect<McpServedResult> {
    const toolCallId = meta[TOOL_USE_META];
    if (typeof toolCallId !== 'string' || toolCallId === '')
      return Effect.succeed({
        text: `Claude Code called ${tool} without naming the tool use it answers (${TOOL_USE_META}), so Tagma did not run it.`,
        isError: true,
      });
    return Effect.map(this.relay.call(toolCallId, tool, input), (answer) => resultOf(answer.content, answer.failed));
  }
}
