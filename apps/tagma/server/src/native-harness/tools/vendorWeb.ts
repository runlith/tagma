import { convertHtmlToStockMarkdown } from '@runlith/agent-tools/webfetch';
import type { Egress } from '@runlith/agent-tools/world';
import type { ToolCatalog } from '@runlith/agent/catalog';
import type { Condition, PermissionSubject } from '@runlith/agent/permissions';
import { NO_CLAIMS, Tool, ToolAnswer, ToolFailed, type ToolPreparationCall, toolPrepare, toolSubjects } from '@runlith/agent/tool';
import type { Message } from '@runlith/llm/schema/messages';
import type { LLMError } from '@runlith/llm/schema/errors';
import type {
  WebMemory,
  WebPages,
  WebRefused,
  WebTargets,
  WebToolName,
  WebWire,
  ServedWeb,
  WebLifetimes,
} from '@runlith/llm/profiles/vendorWeb';
import { Effect, type Schema } from 'effect';

export type VendorThreadWeb = {
  readonly web: ServedWeb;
  readonly memory: (lifetimes: WebLifetimes) => WebMemory;
};

type Bound = {
  readonly wire: WebWire;
  readonly input: Schema.Codec<unknown, unknown>;
  reads(input: unknown): boolean;
  targets(input: unknown): WebTargets;
  run(input: unknown, messages: readonly Message[]): Effect.Effect<string, LLMError | WebRefused>;
};

const READS_PAGES = 'reads-pages';

const pagesOf = (egress: Egress): WebPages => ({
  fetch: (url, request) =>
    egress.fetch(url, { method: 'GET', headers: { ...request.headers }, signal: request.signal, redirect: 'manual' }),
  markdown: convertHtmlToStockMarkdown,
});

const readsPages = (fetch: Tool): Condition => ({
  id: READS_PAGES,
  label: 'Reads pages',
  asksFrom: fetch.approval.asksFrom,
  timeout: 'timeout' in fetch.approval ? fetch.approval.timeout : 'none',
});

const subjectsOf = (
  tool: Tool | undefined,
  input: unknown,
  call: ToolPreparationCall,
): Effect.Effect<readonly PermissionSubject[], ToolFailed> => {
  if (tool === undefined) return Effect.succeed([]);
  const prepare = toolPrepare(tool);
  return prepare === null
    ? Effect.succeed(toolSubjects(tool, input, call.caller))
    : Effect.map(prepare(input, call), (prepared) => prepared.subjects);
};

const subjectOf = (targets: WebTargets): string | undefined => targets.queries[0] ?? targets.pages[0];

const vendorTool = (web: Bound, reads: Condition, tagma: ToolCatalog) =>
  Tool.make({
    approval: { asksFrom: 'never', when: [reads] },
    description: web.wire.description,
    parameters: web.input,
    inputSchema: web.wire.inputSchema,
    vendor: web.wire.vendor,
    display: (input) => ({ form: 'none', title: subjectOf(web.targets(input)) }),
    claims: NO_CLAIMS,
    prepare: Effect.fnUntraced(function* (input, call) {
      const targets = web.targets(input);
      const queries = yield* Effect.forEach(targets.queries, (query) => subjectsOf(tagma['websearch'], { query }, call));
      const pages = yield* Effect.forEach(targets.pages, (url) => subjectsOf(tagma['webfetch'], { url }, call));
      return {
        subjects: [...queries.flat(), ...pages.flat()],
        raised: web.reads(input)
          ? [{ condition: READS_PAGES, fact: targets.pages.length === 0 ? 'the call opens pages' : targets.pages.join(', ') }]
          : [],
      };
    }),
    execute: (input, call) =>
      web.run(input, call.messages).pipe(
        Effect.mapError((failure) => new ToolFailed({ reason: failure.message })),
        Effect.map((text) => new ToolAnswer(text, { form: 'markdown', title: subjectOf(web.targets(input)), text })),
      ),
  });

const bound = (thread: VendorThreadWeb, egress: Egress): ReadonlyArray<readonly [WebToolName, Bound]> => {
  const web = thread.web;
  if (web.lifetimes === undefined) {
    return (['websearch', 'webfetch'] as const).flatMap((name) => {
      const tool = web.tools[name];
      return tool === undefined ? [] : [[name, { ...tool, run: (input, messages) => tool.run(input, { messages }) }] as const];
    });
  }
  const page = { pages: pagesOf(egress), memory: thread.memory(web.lifetimes) };
  return (['websearch', 'webfetch'] as const).flatMap((name) => {
    const tool = web.tools[name];
    return tool === undefined ? [] : [[name, { ...tool, run: (input, messages) => tool.run(input, { ...page, messages }) }] as const];
  });
};

export const vendorWebTools = (thread: VendorThreadWeb, egress: Egress, tagma: ToolCatalog): ToolCatalog => {
  const fetch = tagma['webfetch'];
  if (fetch === undefined) throw new Error('The vendor web asks as webfetch does, and the world offered no webfetch.');
  const reads = readsPages(fetch);
  return Object.fromEntries(bound(thread, egress).map(([name, tool]) => [name, vendorTool(tool, reads, tagma)]));
};
