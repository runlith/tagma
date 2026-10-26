import type { ToolCaller } from '@runlith/agent/contracts';
import { NO_CLAIMS, Tool } from '@runlith/agent/tool';
import type { McpHttpServerDeclaration } from '@runlith/mcp/declaration';
import { mcpAnswer, type McpToolAnswer } from '@runlith/mcp/mcpToolCatalog';
import { Effect, Layer, Schema } from 'effect';
import { DESCRIPTION_WEBSEARCH } from './descriptions';
import { runToolEffect } from './ToolEdge';
import { ToolFailed } from '@runlith/agent/tool';
import type { WebSearchSessions } from './WebSearchSessions';
import type { WebSearchOptions } from './workspace';
import type { WebToolOptions } from './webOptions';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

export const EXA_WEBSEARCH_URL = 'https://mcp.exa.ai/mcp';
export const PARALLEL_WEBSEARCH_URL = 'https://search.parallel.ai/mcp';

type WebSearchProvider = 'exa' | 'parallel';

const PROVIDERS: readonly WebSearchProvider[] = ['parallel', 'exa'];
const EXA_LIMIT = /^You've hit Exa's free MCP rate limit/;

const websearchInputSchema = Schema.Struct({
  query: Schema.String.annotate({ description: 'Websearch query' }),
  numResults: Schema.optional(Schema.Number.annotate({ description: 'Number of search results to return (default: 8)' })),
  livecrawl: Schema.optional(
    Schema.Literals(['fallback', 'preferred']).annotate({
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    }),
  ),
  type: Schema.optional(
    Schema.Literals(['auto', 'fast', 'deep']).annotate({
      description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
    }),
  ),
  contextMaxCharacters: Schema.optional(
    Schema.Number.annotate({
      description: 'Maximum characters for context string optimized for LLMs (default: 10000)',
    }),
  ),
});

type Params = typeof websearchInputSchema.Type;

const endpoints: Readonly<Record<WebSearchProvider, Omit<McpHttpServerDeclaration, 'timeoutMs'>>> = {
  exa: {
    name: 'exa',
    transport: 'http',
    url: EXA_WEBSEARCH_URL,
    capabilities: { kinds: ['network'], mutates: false },
    enabled: true,
  },
  parallel: {
    name: 'parallel',
    transport: 'http',
    url: PARALLEL_WEBSEARCH_URL,
    capabilities: { kinds: ['network'], mutates: false },
    enabled: true,
  },
};

const TOOL_OF: Readonly<Record<WebSearchProvider, string>> = { exa: 'web_search_exa', parallel: 'web_search' };

function searchArguments(
  provider: WebSearchProvider,
  params: Params,
  options: WebSearchOptions,
  caller: ToolCaller,
): Record<string, unknown> {
  if (provider === 'parallel') {
    return {
      objective: params.query,
      search_queries: [params.query],
      session_id: caller.thread?.threadId,
      model_name: options.modelName?.slice(0, 100),
    };
  }
  return {
    query: params.query,
    type: params.type ?? 'auto',
    numResults: params.numResults ?? 8,
    livecrawl: params.livecrawl ?? 'fallback',
    contextMaxCharacters: params.contextMaxCharacters,
  };
}

const refused = (provider: WebSearchProvider, answered: McpToolAnswer): boolean =>
  answered.failed || (provider === 'exa' && EXA_LIMIT.test(answered.text.trimStart()));

export function createWebsearchTool(options: WebToolOptions): Tool {
  const { egress } = options;
  const searchOptions = options.websearch ?? {};
  const search = Effect.fn('WebsearchTool.search')(function* (
    sessions: WebSearchSessions,
    provider: WebSearchProvider,
    params: Params,
    caller: ToolCaller,
  ) {
    const held = yield* sessions.reach({ ...endpoints[provider], timeoutMs: egress.searchMs });
    const result = yield* held.call(provider, TOOL_OF[provider], searchArguments(provider, params, searchOptions, caller));
    return mcpAnswer(result);
  });
  const run = Effect.fn('WebsearchTool.execute')(function* (params: Params, ctx: Tool.ToolCallOptions) {
    const sessions = searchOptions.sessions;
    if (sessions === undefined) {
      return yield* new ToolFailed({
        reason: 'websearch has no session owner: build WebSearchSessions on a scope that outlives runs and pass it as websearch.sessions.',
      });
    }
    const refusals: string[] = [];
    for (const provider of yield* sessions.order(PROVIDERS)) {
      const reached = yield* Effect.result(search(sessions, provider, params, ctx.caller));
      if (reached._tag === 'Success' && !refused(provider, reached.success)) {
        yield* sessions.resume(provider);
        const answer = reached.success.text || 'No search results found. Please try a different query.';
        return new Tool.ToolAnswer(answer, {
          form: 'markdown',
          title: params.query,
          text: answer,
          details: [{ label: 'via', value: provider }],
        });
      }
      refusals.push(`${provider}: ${reached._tag === 'Failure' ? reached.failure.message : reached.success.text}`);
      yield* sessions.pause(provider);
    }
    return yield* new ToolFailed({ reason: `Every search provider refused. ${refusals.join(' ')}` });
  });
  return Tool.make({
    approval: ASKS_NEVER,
    description: DESCRIPTION_WEBSEARCH.replace('{{year}}', new Date().getFullYear().toString()),
    parameters: websearchInputSchema,
    display: { streamFields: ['query'], project: (input) => ({ form: 'none', title: input.query }) },
    execute: (params, call) => runToolEffect('websearch', Layer.empty, run(params, call)),
    subjects: (input) =>
      [...new Set(PROVIDERS.flatMap((provider) => endpoints[provider].capabilities.kinds))].map((kind) => ({
        kind,
        value: input.query,
      })),
    claims: NO_CLAIMS,
  });
}
