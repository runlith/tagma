import { Predicate, Result, Schema } from 'effect';
import type { HarnessRunSeen } from '@runlith/tagma/adapter/harness';

const CHAINED = new Set(['user', 'assistant', 'progress', 'system', 'attachment']);

const Row = Schema.Struct({
  type: Schema.String,
  uuid: Schema.String,
  parentUuid: Schema.optional(Schema.NullOr(Schema.String)),
  isSidechain: Schema.optional(Schema.Boolean),
  teamName: Schema.optional(Schema.Unknown),
  isMeta: Schema.optional(Schema.Boolean),
  isCompactSummary: Schema.optional(Schema.Boolean),
  promptId: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Unknown),
  message: Schema.optional(Schema.Unknown),
});
const decodeRow = Schema.decodeUnknownResult(Row);

type Link = {
  readonly uuid: string;
  readonly parent: string | null;
  readonly type: string;
  readonly at: number;
  readonly main: boolean;
  readonly prompt: boolean;
  readonly promptId: string | undefined;
};

const answers = (message: unknown): boolean => {
  if (!Predicate.isObject(message)) return false;
  const content = (message as { readonly content?: unknown }).content;
  return (
    Array.isArray(content) && content.some((block) => Predicate.isObject(block) && (block as { type?: unknown }).type === 'tool_result')
  );
};

const briefing = (attachment: unknown): boolean =>
  Predicate.isObject(attachment) && (attachment as { readonly type?: unknown }).type === 'fork_briefing';

const linkOf = (line: string, at: number): Link | null => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const decoded = decodeRow(value);
  if (Result.isFailure(decoded)) return null;
  const row = decoded.success;
  if (!CHAINED.has(row.type)) return null;
  return {
    uuid: row.uuid,
    parent: row.parentUuid ?? null,
    type: row.type,
    at,
    main: row.isSidechain !== true && row.teamName === undefined && row.type !== 'progress' && !briefing(row.attachment),
    prompt: row.type === 'user' && row.isMeta !== true && row.isCompactSummary !== true && !answers(row.message),
    promptId: row.promptId,
  };
};

const linksOf = (text: string): ReadonlyMap<string, Link> => {
  const links = new Map<string, Link>();
  text.split('\n').forEach((line, at) => {
    const link = linkOf(line, at);
    if (link !== null) links.set(link.uuid, link);
  });
  return links;
};

const terminalOf = (links: ReadonlyMap<string, Link>): Link | undefined => {
  const main = [...links.values()].filter((link) => link.main);
  const parents = new Set(main.flatMap((link) => (link.parent === null ? [] : [link.parent])));
  const leaves = main.filter((link) => !parents.has(link.uuid)).sort((one, other) => other.at - one.at);
  const spent = new Set<string>();
  for (const leaf of leaves) {
    const walked = new Set<string>();
    for (let at: Link | undefined = leaf; at !== undefined && !spent.has(at.uuid) && !walked.has(at.uuid);) {
      if (at.type === 'user' || at.type === 'assistant') return leaf;
      walked.add(at.uuid);
      if (at.parent === null) break;
      at = links.get(at.parent);
      if (at === undefined) return leaf;
    }
    for (const uuid of walked) spent.add(uuid);
  }
  return undefined;
};

const chainOf = (links: ReadonlyMap<string, Link>, terminal: Link): readonly Link[] => {
  const chain: Link[] = [];
  const walked = new Set<string>();
  for (
    let at: Link | undefined = terminal;
    at !== undefined && !walked.has(at.uuid);
    at = at.parent === null ? undefined : links.get(at.parent)
  ) {
    walked.add(at.uuid);
    chain.push(at);
  }
  return chain.reverse();
};

export const runAddress = ({ turn, before }: HarnessRunSeen): string | null => {
  if (before === null) return null;
  const links = linksOf(before);
  const terminal = terminalOf(links);
  if (terminal === undefined) return null;
  const chain = chainOf(links, terminal);
  for (let index = chain.length - 1; index >= 0; index--) {
    const link = chain[index]!;
    if (link.prompt) {
      if (turn !== null && link.promptId === turn) return link.parent;
      return turn !== null && link.promptId !== undefined ? terminal.uuid : null;
    }
    if (link.type === 'assistant') return terminal.uuid;
  }
  return terminal.uuid;
};

export const turnAddresses = (text: string): readonly (string | null)[] => {
  const links = linksOf(text);
  const terminal = terminalOf(links);
  if (terminal === undefined) return [];
  const addresses: (string | null)[] = [];
  let last: string | undefined;
  for (const link of chainOf(links, terminal)) {
    if (!link.prompt) continue;
    if (link.promptId === undefined || link.promptId !== last) addresses.push(link.parent);
    last = link.promptId;
  }
  return addresses;
};
