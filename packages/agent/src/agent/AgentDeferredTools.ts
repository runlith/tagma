import { Effect, Schema } from 'effect';
import type { Message, ToolResultPart } from '@runlith/llm/schema/messages';
import type { DerivedContribution } from '../catalog/resolveCatalog';
import { type AgentRule, agentRule } from './policy/AgentRuntimePolicy';
import { type ToolCatalog, deferredToolNames } from './ToolCatalog';
import { TOOL_OUTPUT_MAX_LINES } from './ToolOutputSpool';
import { ToolAnswer, ToolFailed, Tool } from './tool';
import { type PackedWorldStateSection, withdrawn, worldStateSection } from './WorldState';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';

export const TOOL_SEARCH_TOOL = 'tool_search';

export type ToolSearchResult = {
  readonly status: 'revealed';
  readonly tools: readonly { readonly name: string; readonly description: string }[];
  readonly direct: readonly string[];
  readonly missing: readonly string[];
  readonly truncated: readonly string[];
  readonly note: string;
};

const SELECT_PREFIX = 'select:';

const REVEALED_NOTE = 'Revealed tools are callable from the next step; their definitions arrive with it.';

const directNote = (names: readonly string[]): string =>
  `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} offered directly in this run, with the definition already in hand: call ${names.length === 1 ? 'it' : 'them'} without a search.`;

const toolSearchParameters = Schema.Struct({
  query: Schema.String.annotate({
    description: `"${SELECT_PREFIX}a,b" reveals exact names; any other text is keywords matched against name and description, and a "+word" must occur in the name.`,
  }),
  max_results: Schema.optional(Schema.Int.annotate({ description: 'How many names one answer may carry; the rest ride `truncated`.' })),
});

export function agentDeferredTools(catalog: ToolCatalog): ToolCatalog {
  const deferred = [...deferredToolNames(catalog)].sort();
  return {
    [TOOL_SEARCH_TOOL]: Tool.make({
      approval: ASKS_NEVER,
      description: [
        "Reveal deferred tools so they can be called. A deferred tool is named in the turn's inventory, but its definition is not offered until this tool has named it; a revealed tool is callable from the next step.",
        `Query forms: "${SELECT_PREFIX}a,b" reveals exact names; "keyword phrase" ranks deferred tools by name and description; "+word other" requires "word" in the name and ranks by the rest.`,
        `The answer lists the revealed names with one-line descriptions and the names past the page; it never carries a schema. A "${SELECT_PREFIX}" answer also splits the rest in two: names this run already offers directly, and names it holds nowhere.`,
      ].join('\n'),
      parameters: toolSearchParameters,
      display: ({ query }) => ({ form: 'none', title: query }),
      execute: Effect.fnUntraced(function* ({ query, max_results }, call) {
        const asked = query.trim();
        if (asked.length === 0)
          return yield* Effect.fail(new ToolFailed({ reason: 'tool_search needs a query: exact names after select:, or keywords.' }));
        const page = pageSize(max_results);
        const chosen = asked.startsWith(SELECT_PREFIX)
          ? selected(asked.slice(SELECT_PREFIX.length), deferred, catalog)
          : ranked(asked, deferred, revealedDeferredToolNames(catalog, call.messages), catalog);
        const shown = withCompanions(chosen.found.slice(0, page), deferred, catalog);
        const value: ToolSearchResult = {
          status: 'revealed',
          tools: shown.map((name) => ({ name, description: firstLine(catalog[name]?.description ?? '') })),
          direct: chosen.direct,
          missing: chosen.missing,
          truncated: chosen.found.slice(page),
          note: chosen.direct.length === 0 ? REVEALED_NOTE : `${REVEALED_NOTE} ${directNote(chosen.direct)}`,
        };
        const facts = [
          ...(chosen.direct.length === 0 ? [] : [{ label: 'offered directly', value: String(chosen.direct.length) }]),
          ...(chosen.missing.length === 0 ? [] : [{ label: 'missing', value: String(chosen.missing.length) }]),
        ];
        return new ToolAnswer(value, {
          form: 'list',
          title: asked,
          items: value.tools.map((tool) => ({ label: tool.name, detail: tool.description })),
          total: chosen.found.length,
          facts: facts.length === 0 ? undefined : facts,
        });
      }),
    }),
  };
}

export const toolSearchContribution: DerivedContribution<Tool> = {
  source: TOOL_SEARCH_TOOL,
  derive: (admitted) => (deferredToolNames(admitted).size === 0 ? {} : agentDeferredTools(admitted)),
};

export function agentDeferredToolRule<TCtx>(catalog: () => ToolCatalog): AgentRule<TCtx> {
  return agentRule<TCtx>(
    'deferred-tools',
    (ctx) => {
      if (ctx.hook !== 'beforeStep') return null;
      const current = catalog();
      const hidden = deferredToolExclusions(current, ctx.modelMessages);
      return hidden.length === 0 ? null : { type: 'exclude', tools: hidden };
    },
    { owner: 'catalog', critical: true },
  );
}

export function deferredToolExclusions(catalog: ToolCatalog, messages: readonly Message[]): readonly string[] {
  const deferred = deferredToolNames(catalog);
  if (deferred.size === 0) return [];
  const revealed = revealedDeferredToolNames(catalog, messages);
  return [...deferred].filter((name) => !revealed.has(name));
}

export const DEFERRED_HOW_TO = [
  `Deferred tools are reachable through \`${TOOL_SEARCH_TOOL}\`: "${SELECT_PREFIX}a,b" reveals exact names, any other text ranks them by keyword.`,
  'Until a search names one, its definition is not offered; a revealed tool is callable from the next step.',
].join(' ');

export function deferredToolsSection(catalog: ToolCatalog): PackedWorldStateSection {
  const names = [...deferredToolNames(catalog)].sort();
  return worldStateSection({
    id: 'deferred-tools',
    codec: Schema.Array(Schema.String),
    read: () => (names.length === 0 ? withdrawn : names),
    baseline: (current) => ({ type: 'text', text: `${DEFERRED_HOW_TO}\n\n${renderNames(current)}`, deferredTools: current }),
    update: (_previous, current) => ({
      type: 'text',
      text: `The deferred tools have changed. This list supersedes the previous one.\n\n${renderNames(current)}`,
      deferredTools: current,
    }),
    removed: () => ({ type: 'text', text: 'Every tool this run offers is declared directly.', deferredTools: [] }),
  });
}

function renderNames(names: readonly string[]): string {
  return ['Deferred tools:', ...names.map((name) => `- ${name}`)].join('\n');
}

export type UnrevealedDefinition = { readonly note: string; readonly schema: Tool['inputSchema'] };

export function unrevealedDefinition(name: string, tool: Tool, messages: readonly Message[]): UnrevealedDefinition | null {
  if (tool.exposure !== 'deferred' || discoveredToolNames(messages).has(name)) return null;
  return {
    note: `${name} is deferred and this run never revealed its definition; its input schema rides this refusal as \`schema\`: rewrite the call against it.`,
    schema: tool.inputSchema,
  };
}

export function revealedDeferredToolNames(catalog: ToolCatalog, messages: readonly Message[]): ReadonlySet<string> {
  const deferred = deferredToolNames(catalog);
  return new Set([...discoveredToolNames(messages)].filter((name) => deferred.has(name)));
}

const FOLDED_REFERENCES = 'toolReferences';

export function foldedReferences(folded: readonly Message[]): Message['metadata'] {
  const names = [...discoveredToolNames(folded)];
  return names.length === 0 ? undefined : { [FOLDED_REFERENCES]: names };
}

function carriedReferences(message: Message): readonly string[] {
  const carried = message.metadata?.[FOLDED_REFERENCES];
  return Array.isArray(carried) ? carried.filter((name): name is string => typeof name === 'string') : [];
}

export function discoveredToolNames(messages: readonly Message[]): ReadonlySet<string> {
  const revealed = new Set<string>();
  for (const message of messages) {
    for (const name of message.compaction?.toolReferences ?? []) revealed.add(name);
    for (const name of carriedReferences(message)) revealed.add(name);
    if (message.role !== 'assistant' && message.role !== 'tool') continue;
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue;
      for (const name of part.toolReferences ?? []) revealed.add(name);
      for (const name of toolSearchReferences(part)) revealed.add(name);
    }
  }
  return revealed;
}

type Chosen = {
  readonly found: readonly string[];
  readonly direct: readonly string[];
  readonly missing: readonly string[];
};

function withCompanions(found: readonly string[], deferred: readonly string[], catalog: ToolCatalog): readonly string[] {
  const known = new Set(deferred);
  const shown = new Set(found);
  for (const name of found) for (const companion of catalog[name]?.companions ?? []) if (known.has(companion)) shown.add(companion);
  return [...shown];
}

function selected(names: string, deferred: readonly string[], catalog: ToolCatalog): Chosen {
  const known = new Set(deferred);
  const seen = new Set<string>();
  const found: string[] = [];
  const direct: string[] = [];
  const missing: string[] = [];
  for (const raw of names.split(',')) {
    const name = raw.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    if (known.has(name)) found.push(name);
    else if (catalog[name] !== undefined || name === TOOL_SEARCH_TOOL) direct.push(name);
    else missing.push(name);
  }
  return { found, direct, missing };
}

function ranked(query: string, deferred: readonly string[], revealed: ReadonlySet<string>, catalog: ToolCatalog): Chosen {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const required = terms
    .filter((term) => term.startsWith('+'))
    .map((term) => term.slice(1))
    .filter((term) => term.length > 0);
  const scored = terms.map((term) => (term.startsWith('+') ? term.slice(1) : term)).filter((term) => term.length > 0);
  if (scored.length === 0) return { found: [], direct: [], missing: [] };
  const hits = deferred.flatMap((name) => {
    if (revealed.has(name)) return [];
    const lowered = name.toLowerCase();
    if (!required.every((term) => lowered.includes(term))) return [];
    const description = (catalog[name]?.description ?? '').toLowerCase();
    let exact = 0;
    let inName = 0;
    let inDescription = 0;
    for (const term of scored) {
      if (lowered === term) exact += 1;
      else if (lowered.includes(term)) inName += 1;
      if (description.includes(term)) inDescription += 1;
    }
    return exact + inName + inDescription === 0 ? [] : [{ name, exact, inName, inDescription }];
  });
  hits.sort(
    (left, right) =>
      right.exact - left.exact ||
      right.inName - left.inName ||
      right.inDescription - left.inDescription ||
      left.name.localeCompare(right.name),
  );
  return { found: hits.map((hit) => hit.name), direct: [], missing: [] };
}

function pageSize(asked: number | undefined): number {
  if (asked === undefined || !Number.isFinite(asked)) return TOOL_OUTPUT_MAX_LINES;
  return Math.min(TOOL_OUTPUT_MAX_LINES, Math.max(1, Math.floor(asked)));
}

function firstLine(description: string): string {
  return description.split('\n')[0]?.trim() ?? '';
}

export function toolSearchReferences(part: ToolResultPart): readonly string[] {
  if (part.name !== TOOL_SEARCH_TOOL || part.result.type !== 'json') return [];
  const value = part.result.value as { status?: unknown; tools?: unknown } | null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  if (value.status !== 'revealed' || !Array.isArray(value.tools)) return [];
  return value.tools.flatMap((tool) =>
    typeof tool === 'object' && tool !== null && typeof (tool as { name?: unknown }).name === 'string'
      ? [(tool as { name: string }).name]
      : [],
  );
}
