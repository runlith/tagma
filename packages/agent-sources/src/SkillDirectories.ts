import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type AgentSkill, AgentSkillUnreadable } from '@runlith/agent/AgentSkill';
import { Effect, FileSystem } from 'effect';

export const SKILL_FILE = 'SKILL.md';

export const REFERENCES_DIRECTORY = 'references';

export type SkillSourceRequest = {
  readonly directories: readonly string[];
};

export type DiscoveredReference = {
  readonly name: string;
  readonly description?: string;
  readonly path: string;
};

export type DiscoveredSkill = {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly body: string;
  readonly path: string;
  readonly directory: string;
  readonly location: string;
  readonly references: readonly DiscoveredReference[];
};

export type SkillDiscovery = {
  readonly skills: readonly DiscoveredSkill[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
};

export const discoverSkills = Effect.fn('SkillDirectories.discover')(function* (request: SkillSourceRequest) {
  const fs = yield* FileSystem.FileSystem;
  const byName = new Map<string, DiscoveredSkill>();
  const rejected: { path: string; reason: string }[] = [];

  for (const directory of request.directories) {
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
      const location = path.join(directory, entry);
      const info = yield* fs.stat(location).pipe(Effect.result);
      if (info._tag === 'Failure') {
        if (info.failure.reason._tag !== 'NotFound') {
          rejected.push({ path: location, reason: info.failure.message });
        }
        continue;
      }
      if (info.success.type !== 'Directory') continue;
      const file = path.join(location, SKILL_FILE);
      const readable = yield* fs.exists(file).pipe(Effect.option);
      if (readable._tag === 'None') {
        rejected.push({ path: file, reason: 'unreadable' });
        continue;
      }
      if (!readable.value) continue;
      const raw = yield* fs.readFileString(file).pipe(Effect.option);
      if (raw._tag === 'None') {
        rejected.push({ path: file, reason: 'unreadable' });
        continue;
      }
      const parsed = parseSkill(raw.value);
      if ('reason' in parsed) {
        rejected.push({ path: file, reason: parsed.reason });
        continue;
      }
      const resolved = yield* fs.realPath(location).pipe(Effect.option);
      if (resolved._tag === 'None') {
        rejected.push({ path: location, reason: 'unreadable' });
        continue;
      }
      const references = yield* referencesIn(path.join(resolved.value, REFERENCES_DIRECTORY));
      if (references === 'unreadable') {
        rejected.push({ path: path.join(location, REFERENCES_DIRECTORY), reason: 'unreadable' });
        continue;
      }
      byName.set(entry, { ...parsed, name: entry, path: file, directory, location: resolved.value, references });
    }
  }

  return { skills: [...byName.values()], rejected } satisfies SkillDiscovery;
});

const referencesIn = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const kind = yield* fs.stat(directory).pipe(
    Effect.map((info) => (info.type === 'Directory' ? ('directory' as const) : ('other' as const))),
    Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('absent' as const)),
    Effect.option,
  );
  if (kind._tag === 'None') return 'unreadable' as const;
  if (kind.value !== 'directory') return [];
  const listed = yield* fs.readDirectory(directory).pipe(Effect.option);
  if (listed._tag === 'None') return 'unreadable' as const;
  const references: DiscoveredReference[] = [];
  for (const entry of listed.value.filter((name) => name.endsWith('.md')).sort()) {
    const file = path.join(directory, entry);
    const text = yield* fs.readFileString(file).pipe(Effect.option);
    if (text._tag === 'None') return 'unreadable' as const;
    const first = text.value
      .replace(/^\uFEFF/, '')
      .split('\n', 1)[0]!
      .replace(/^#+\s*/, '')
      .trim();
    references.push({ name: entry.slice(0, -'.md'.length), description: first === '' ? undefined : first, path: file });
  }
  return references;
});

export function asAgentSkills<TCtx>(discovered: readonly DiscoveredSkill[]): AgentSkill<TCtx>[] {
  return discovered.map((skill) => ({
    id: skill.name,
    description: skill.whenToUse ? `${skill.description} Use when: ${skill.whenToUse}` : skill.description,
    location: skill.location,
    references: skill.references.map((reference) => ({
      name: reference.name,
      description: reference.description,
      text: () => currentText(reference.path),
    })),
    instructions: () => currentBody(skill.path),
  }));
}

const currentText = (file: string) =>
  Effect.tryPromise({
    try: () => readFile(file, 'utf8'),
    catch: (cause) =>
      new AgentSkillUnreadable({ reason: `${file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });

const currentBody = Effect.fn('SkillDirectories.currentBody')(function* (file: string) {
  const raw = yield* Effect.tryPromise({
    try: () => readFile(file, 'utf8'),
    catch: (cause) =>
      new AgentSkillUnreadable({ reason: `${file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });
  const parsed = parseSkill(raw);
  if ('reason' in parsed) return yield* new AgentSkillUnreadable({ reason: `${file} cannot be loaded: ${parsed.reason}.` });
  return parsed.body;
});

type ParsedSkill = { description: string; whenToUse?: string; body: string } | { reason: string };

function parseSkill(raw: string): ParsedSkill {
  const text = raw.replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return { reason: 'no frontmatter' };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { reason: 'unterminated frontmatter' };
  const frontmatter = text.slice(text.indexOf('\n') + 1, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1).trim();
  if (body.length === 0) return { reason: 'empty body' };

  const fields = frontmatterFields(frontmatter);

  const description = fields.get('description');
  if (!description) return { reason: 'no description' };
  const whenToUse = fields.get('whenToUse') ?? fields.get('when-to-use');
  return whenToUse ? { description, whenToUse, body } : { description, body };
}

function frontmatterFields(frontmatter: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = frontmatter.split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[at] as string);
    if (!match) continue;
    const key = match[1] as string;
    const inline = (match[2] as string).trim();
    const block = /^[|>][+-]?$/.test(inline);
    const continuation: string[] = [];
    while (at + 1 < lines.length && /^\s+\S/.test(lines[at + 1] as string)) {
      at += 1;
      continuation.push((lines[at] as string).trim());
    }
    const folded = continuation.join(' ');
    fields.set(key, block ? folded : unquote(folded.length === 0 ? inline : `${inline} ${folded}`.trim()));
  }
  return fields;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
