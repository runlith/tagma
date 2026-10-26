import type { ToolCaller } from '@runlith/agent/contracts';
import { callerInThread, unthreadedCaller } from './testing/caller';
import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Tool, ToolAnswer, ToolFailed, toolExecute, toolSubjects } from '@runlith/agent/tool';
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import { WebSearchSessions } from './WebSearchSessions';
import { createWebsearchTool } from './websearch';
import { machineWorld } from './world/machine';

type Served = {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: { readonly url: string; readonly tool: string; readonly args: Record<string, unknown> }[];
  readonly initializes: () => number;
  readonly deletes: () => number;
};

type Reply = { readonly text: string; readonly isError?: boolean } | { readonly fault: string };

const text = (value: string): Reply => ({ text: value });

function serveSearch(answer: (tool: string, args: Record<string, unknown>) => Reply): Served {
  const calls: { url: string; tool: string; args: Record<string, unknown> }[] = [];
  let initializes = 0;
  let deletes = 0;
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const open = async (url: string) => {
    const standing = transports.get(url);
    if (standing) return standing;
    const server = new Server({ name: 'search-test', version: '0.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'web_search_exa', inputSchema: { type: 'object' as const } },
        { name: 'web_search', inputSchema: { type: 'object' as const } },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments?: unknown } }) => {
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      calls.push({ url, tool: request.params.name, args });
      const reply = answer(request.params.name, args);
      if ('fault' in reply) throw new Error(reply.fault);
      return { content: [{ type: 'text' as const, text: reply.text }], isError: reply.isError === true ? true : undefined };
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
    await server.connect(transport);
    transports.set(url, transport);
    return transport;
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const body = request.method === 'POST' ? await request.clone().text() : '';
    if (body.includes('"method":"initialize"')) initializes += 1;
    if (request.method === 'DELETE') deletes += 1;
    const transport = await open(new URL(request.url).toString());
    return transport.handleRequest(request);
  }) as unknown as typeof globalThis.fetch;

  return { fetch: fetchImpl, calls, initializes: () => initializes, deletes: () => deletes };
}

const owned = Effect.fnUntraced(function* (fetch: typeof globalThis.fetch) {
  const scope = yield* Scope.make();
  const close = () => Scope.close(scope, Exit.void);
  yield* Effect.addFinalizer(close);
  const sessions = yield* WebSearchSessions.make({ fetch }).pipe(Scope.provide(scope));
  return { sessions, close };
});

describe('websearch through the MCP client', () => {
  it.effect('asks Parallel first, with the session metadata that endpoint takes', () =>
    Effect.gen(function* () {
      const served = serveSearch(() => text('parallel result'));
      const { sessions } = yield* owned(served.fetch);
      const tool = createWebsearchTool({
        egress: machineWorld.egress,
        websearch: { modelName: 'claude-opus-4.7-long-name', sessions },
      });

      expect(yield* execute(tool, { query: 'serbian cases' }, { caller: callerInThread('session-1', 'run-1') })).toBe('parallel result');
      expect(toolSubjects(tool, { query: 'serbian cases' }, unthreadedCaller)).toEqual([{ kind: 'network', value: 'serbian cases' }]);
      expect(served.calls).toEqual([
        {
          url: 'https://search.parallel.ai/mcp',
          tool: 'web_search',
          args: {
            objective: 'serbian cases',
            search_queries: ['serbian cases'],
            session_id: 'session-1',
            model_name: 'claude-opus-4.7-long-name',
          },
        },
      ]);
    }),
  );

  it.effect('answers from Exa in its own argument shape when Parallel fails, and later calls skip the resting Parallel', () =>
    Effect.gen(function* () {
      const served = serveSearch((tool) => (tool === 'web_search' ? { fault: 'rate limited' } : text('exa result')));
      const { sessions } = yield* owned(served.fetch);
      const first = createWebsearchTool({ egress: machineWorld.egress, websearch: { sessions } });
      const second = createWebsearchTool({ egress: machineWorld.egress, websearch: { sessions } });

      expect(yield* settle(first, { query: 'AI news 2026' })).toEqual({ answered: 'exa result' });
      expect(yield* settle(second, { query: 'later' })).toEqual({ answered: 'exa result' });
      expect(served.calls.map((call) => call.tool)).toEqual(['web_search', 'web_search_exa', 'web_search_exa']);
      expect(served.calls[1]).toEqual({
        url: 'https://mcp.exa.ai/mcp',
        tool: 'web_search_exa',
        args: { query: 'AI news 2026', type: 'auto', numResults: 8, livecrawl: 'fallback' },
      });
    }),
  );

  it.effect('fails with every refusal when both refuse, and the next call still tries the provider resting longest', () =>
    Effect.gen(function* () {
      let down = true;
      const served = serveSearch((tool) => {
        if (!down) return text(`${tool} result`);
        return tool === 'web_search'
          ? { text: 'quota exhausted', isError: true }
          : text("You've hit Exa's free MCP rate limit. Create your own Exa API key.");
      });
      const { sessions } = yield* owned(served.fetch);
      const tool = createWebsearchTool({ egress: machineWorld.egress, websearch: { sessions } });

      const refused = yield* settle(tool, { query: 'q' });
      expect(refused.answered).toBeUndefined();
      expect(refused.failed).toContain('quota exhausted');
      expect(refused.failed).toContain("You've hit Exa's free MCP rate limit");

      down = false;
      expect(yield* settle(tool, { query: 'q' })).toEqual({ answered: 'web_search result' });
      expect(served.calls.map((call) => call.tool)).toEqual(['web_search', 'web_search_exa', 'web_search']);
    }),
  );

  it.effect('initializes once for every run of one owner, and the owner\u2019s close ends the session', () =>
    Effect.gen(function* () {
      const served = serveSearch((_tool, args) => text(`results for ${String(args.objective)}`));
      const { sessions, close } = yield* owned(served.fetch);
      const first = createWebsearchTool({ egress: machineWorld.egress, websearch: { sessions } });
      const second = createWebsearchTool({
        egress: machineWorld.egress,
        websearch: { sessions },
      });

      expect(yield* execute(first, { query: 'first' })).toBe('results for first');
      expect(yield* execute(second, { query: 'second' })).toBe('results for second');
      expect(served.calls).toHaveLength(2);
      expect(served.initializes()).toBe(1);
      expect(served.deletes()).toBe(0);

      yield* close();
      expect(served.deletes()).toBe(1);
    }),
  );

  it.effect('refuses a search when the embedder owns no sessions, instead of opening one nobody closes', () =>
    Effect.gen(function* () {
      const served = serveSearch(() => text('unreachable'));
      const tool = createWebsearchTool({ egress: machineWorld.egress, websearch: {} });

      expect(yield* execute(tool, { query: 'anything' })).toContain('websearch has no session owner');
      expect(served.calls).toEqual([]);
      expect(served.initializes()).toBe(0);
    }),
  );

  it.effect('an interrupted search ends at once and reaches the provider once, never as a timeout', () =>
    Effect.gen(function* () {
      const reached = Deferred.makeUnsafe<void>();
      const served = serveSearch(() => text('never answered'));
      let searches = 0;
      const stalling = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const body = request.method === 'POST' ? await request.clone().text() : '';
        if (!body.includes('tools/call')) return served.fetch(request);
        searches += 1;
        Deferred.doneUnsafe(reached, Exit.void);
        return new Promise<Response>(() => undefined);
      }) as unknown as typeof globalThis.fetch;
      const { sessions } = yield* owned(stalling);
      const tool = createWebsearchTool({
        egress: machineWorld.egress,
        websearch: { sessions },
      });

      const run = toolExecute(tool);
      if (!run) return yield* Effect.die(new Error('The tool declares no execute.'));
      const searching = yield* Effect.forkChild(
        run({ query: 'bounded cancellation' }, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] }),
      );
      yield* Deferred.await(reached);
      const ended = yield* Fiber.interrupt(searching).pipe(Effect.andThen(Fiber.await(searching)));

      expect(Exit.isFailure(ended) && Cause.hasInterruptsOnly(ended.cause)).toBe(true);
      expect(searches).toBe(1);
    }),
  );
});

type Settled = { readonly answered?: string; readonly failed?: string };

const settle = Effect.fnUntraced(function* (
  entry: Tool,
  input: { query: string },
  options: { caller?: ToolCaller } = {},
): Effect.fn.Return<Settled> {
  const run = toolExecute(entry);
  if (!run) return yield* Effect.die(new Error('The tool declares no execute.'));
  return yield* (
    run(input, {
      toolCallId: 'call-1',
      caller: options.caller ?? unthreadedCaller,
      messages: [],
    }) as Effect.Effect<unknown, ToolFailed>
  ).pipe(
    Effect.map((value): Settled => ({ answered: String(value instanceof ToolAnswer ? value.value : value) })),
    Effect.catch((failure) => Effect.succeed<Settled>({ failed: failure.reason })),
  );
});

const execute = Effect.fnUntraced(function* (entry: Tool, input: { query: string }, options: { caller?: ToolCaller } = {}) {
  const settled = yield* settle(entry, input, options);
  return settled.answered ?? settled.failed ?? '';
});
