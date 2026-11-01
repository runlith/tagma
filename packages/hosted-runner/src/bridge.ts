import { Deferred, Effect, Option } from 'effect';
import { mcpToolServer, type McpServedResult, type McpServedTool, type McpServerInput } from '@runlith/mcp/server';
import type { HostedDoor } from './door.js';
import type { Handed } from './handed.js';
import { Relay } from './relay.js';
import type { HostedContent, HostedToolWire } from './wire/messages.js';

export const TAGMA_SERVER = 'tagma';

export const SERVED = `mcp__${TAGMA_SERVER}__`;

export const servedPrompt = (prompt: string): string =>
  `${prompt}\n\nThe Tagma tools in your tool list are named \`${SERVED}<name>\`, where \`<name>\` is the name these instructions give the tool.`;

export type BridgeVendor = {
  readonly name: string;
  readonly callIdOf: (meta: Readonly<Record<string, unknown>>) => string | null;
  readonly relists: boolean;
};

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
  readonly input: McpServerInput;
  readonly server: ReturnType<typeof mcpToolServer>;
  private readonly relay: Relay;

  constructor(
    door: HostedDoor,
    handed: Handed,
    private readonly stderr: (text: string) => void,
    broke: (reason: string) => Effect.Effect<void>,
    queued: (words: readonly string[]) => Effect.Effect<void>,
    private readonly vendor: BridgeVendor,
  ) {
    this.served = [];
    this.relay = new Relay(door, handed, {
      changed: () => Effect.flatMap(door.tools(), (listed) => this.serve(listed.tools)),
      queued,
      stderr,
      broke,
    });
    this.input = {
      name: TAGMA_SERVER,
      version: '1',
      tools: () => {
        for (const listed of this.relisting) Deferred.doneUnsafe(listed, Effect.void);
        this.relisting.clear();
        return this.served;
      },
      call: (tool, input, meta, _requestId, signal) => Effect.runPromise(this.called(tool, input, meta), { signal }),
    };
    this.server = mcpToolServer(this.input);
  }

  readonly serve = Effect.fnUntraced(function* (this: Bridge, tools: readonly HostedToolWire[]) {
    const listed = yield* this.offer(tools);
    if (listed === null) return;
    const heard = yield* Deferred.await(listed).pipe(Effect.timeoutOption(RELIST_MS));
    if (Option.isSome(heard)) return;
    this.relisting.delete(listed);
    this.stderr(
      `${this.vendor.name} did not list Tagma's tools again within ${RELIST_MS} ms of being told they changed; its next request may carry the previous list\n`,
    );
  });

  private readonly offer = Effect.fnUntraced(
    function* (this: Bridge, tools: readonly HostedToolWire[]) {
      const served = tools.map(servedOf);
      if (sameTools(served, this.served)) return [...this.relisting].at(-1) ?? null;
      this.served = served;
      if (!this.vendor.relists) return null;
      const listed = yield* Deferred.make<void>();
      this.relisting.add(listed);
      yield* Effect.promise(() => this.server.server.sendToolListChanged());
      return listed;
    },
    (work) => Effect.uninterruptible(work),
  );

  private called(tool: string, input: unknown, meta: Readonly<Record<string, unknown>>): Effect.Effect<McpServedResult> {
    const toolCallId = this.vendor.callIdOf(meta);
    if (toolCallId === null)
      return Effect.succeed({
        text: `${this.vendor.name} called ${tool} without naming the tool use it answers, so Tagma did not run it.`,
        isError: true,
      });
    return Effect.map(this.relay.call(toolCallId, tool, input), (answer) => resultOf(answer.content, answer.failed));
  }
}
