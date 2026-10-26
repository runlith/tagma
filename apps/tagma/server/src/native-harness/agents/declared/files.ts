import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Effect, FileSystem, Schema } from 'effect';
import { sectionEditSchema } from '@runlith/agent/thread/agents/AgentProfile';
import {
  agentFrontmatterSchema,
  type AgentFile,
  type AgentFileDiscovery,
  type AgentFloor,
} from '../../../threads/contract/wire/agentLibrary.js';

export const AGENT_FILE_SUFFIX = '.md';

export const discoverAgentFiles = Effect.fn('AgentFiles.discover')(function* (floors: readonly AgentFloor[], known: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const byName = new Map<string, AgentFile>();
  const rejected: { path: string; reason: string }[] = [];

  for (const { directory, origin } of floors) {
    const present = yield* fs.exists(directory).pipe(Effect.option);
    if (present._tag === 'None') {
      rejected.push({ path: directory, reason: 'unreadable' });
      continue;
    }
    if (!present.value) continue;
    const listed = yield* fs.readDirectory(directory).pipe(Effect.option);
    if (listed._tag === 'None') {
      rejected.push({ path: directory, reason: 'unreadable' });
      continue;
    }
    for (const entry of listed.value.slice().sort()) {
      if (!entry.endsWith(AGENT_FILE_SUFFIX)) continue;
      const file = path.join(directory, entry);
      const raw = yield* fs.readFileString(file).pipe(Effect.option);
      if (raw._tag === 'None') {
        rejected.push({ path: file, reason: 'unreadable' });
        continue;
      }
      const parsed = parseAgentFile(entry.slice(0, -AGENT_FILE_SUFFIX.length), raw.value, known);
      if ('reason' in parsed) {
        rejected.push({ path: file, reason: parsed.reason });
        continue;
      }
      const shadowed = byName.get(parsed.id);
      if (shadowed !== undefined) rejected.push({ path: shadowed.path, reason: `shadowed by ${file}` });
      byName.set(parsed.id, { ...parsed, path: file, directory, origin });
    }
  }

  return { agents: [...byName.values()], rejected } satisfies AgentFileDiscovery;
});

const decodeFrontmatter = Schema.decodeUnknownResult(agentFrontmatterSchema);
const decodeSections = Schema.decodeUnknownResult(Schema.Array(sectionEditSchema));

export function parseAgentFile(
  name: string,
  raw: string,
  known: readonly string[],
): Omit<AgentFile, 'path' | 'directory' | 'origin'> | { readonly reason: string } {
  const text = raw.replace(/^\uFEFF/, '');
  const opening = /^---\r?\n/.exec(text);
  if (opening === null) return { reason: 'no frontmatter' };
  const delimiter = /^---\r?$/gm;
  delimiter.lastIndex = opening[0].length;
  const closing = delimiter.exec(text);
  if (closing === null) return { reason: 'unterminated frontmatter' };
  const frontmatter = text.slice(opening[0].length, closing.index);
  const body = text.slice(closing.index + closing[0].length).trim();

  let document: unknown;
  try {
    document = Bun.YAML.parse(frontmatter) ?? {};
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : 'unreadable frontmatter' };
  }
  const decoded = decodeFrontmatter(document);
  if (decoded._tag === 'Failure') return { reason: decoded.failure.message };
  const fields = decoded.success;
  if (body.length === 0 && fields.extends === undefined) return { reason: 'empty body: the prompt is the body of the file' };
  const sections =
    fields.sections === undefined
      ? undefined
      : decodeSections((document as Readonly<Record<string, unknown>>).sections, { onExcessProperty: 'error' });
  if (sections?._tag === 'Failure') return { reason: `sections: ${sections.failure.message}` };
  const unknown = fields.capabilities?.find((id) => !known.includes(id));
  if (unknown !== undefined) return { reason: `${unknown} is not a capability of this server; one of ${known.join(', ')}` };
  if (fields.extends === undefined && fields.capabilities === undefined) {
    return { reason: 'an agent standing alone names its capabilities; an empty list is a chat with no tools' };
  }
  return {
    id: name,
    description: fields.description ?? '',
    extends: fields.extends,
    capabilities: fields.capabilities,
    tools: fields.tools,
    model: fields.model,
    sections: sections?.success,
    body,
    revision: createHash('sha256').update(raw).digest('hex'),
    source: raw,
  };
}
