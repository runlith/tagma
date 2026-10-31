import { readFile, realpath } from 'node:fs/promises';
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
  readonly bound?: SkillBound;
};

export type SkillBound = {
  readonly root: string;
  readonly render: (text: string) => string;
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
      const read = yield* readSkillFolder({ name: entry, location: path.join(directory, entry), directory });
      if (read === null) continue;
      if ('location' in read) byName.set(entry, read);
      else rejected.push(read);
    }
  }

  return { skills: [...byName.values()], rejected } satisfies SkillDiscovery;
});

export type NamedSkillFolder = {
  readonly name: string;
  readonly location: string;
  readonly directory: string;
  readonly bound?: SkillBound;
};

export const readSkillFolders = Effect.fn('SkillDirectories.readFolders')(function* (folders: readonly NamedSkillFolder[]) {
  const skills: DiscoveredSkill[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const folder of folders) {
    const read = yield* readSkillFolder(folder);
    if (read === null) rejected.push({ path: folder.location, reason: `not a folder holding ${SKILL_FILE}` });
    else if ('location' in read) skills.push(read);
    else rejected.push(read);
  }
  return { skills, rejected } satisfies SkillDiscovery;
});

type SkillRejection = { readonly path: string; readonly reason: string };

const readSkillFolder = Effect.fnUntraced(function* ({
  name,
  location,
  directory,
  bound: asked,
}: NamedSkillFolder): Effect.fn.Return<DiscoveredSkill | SkillRejection | null, never, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(location).pipe(Effect.result);
  if (info._tag === 'Failure') {
    return info.failure.reason._tag === 'NotFound' ? null : { path: location, reason: info.failure.message };
  }
  if (info.success.type !== 'Directory') return null;
  let bound: SkillBound | undefined;
  if (asked !== undefined) {
    const root = yield* fs.realPath(asked.root).pipe(Effect.option);
    if (root._tag === 'None') return { path: asked.root, reason: 'unreadable' };
    bound = { ...asked, root: root.value };
  }
  const file = path.join(location, SKILL_FILE);
  const readable = yield* fs.exists(file).pipe(Effect.option);
  if (readable._tag === 'None') return { path: file, reason: 'unreadable' };
  if (!readable.value) return null;
  const escaped = yield* outside(bound, file);
  if (escaped !== null) return escaped;
  const raw = yield* fs.readFileString(file).pipe(Effect.option);
  if (raw._tag === 'None') return { path: file, reason: 'unreadable' };
  const parsed = parseSkill(raw.value);
  if ('reason' in parsed) return { path: file, reason: parsed.reason };
  const resolved = yield* fs.realPath(location).pipe(Effect.option);
  if (resolved._tag === 'None') return { path: location, reason: 'unreadable' };
  const references = yield* referencesIn(path.join(resolved.value, REFERENCES_DIRECTORY), bound);
  if (references === 'unreadable') return { path: path.join(location, REFERENCES_DIRECTORY), reason: 'unreadable' };
  if (!Array.isArray(references)) return references;
  const body = bound === undefined ? parsed.body : bound.render(parsed.body);
  return {
    ...parsed,
    body,
    name,
    path: file,
    directory,
    location: resolved.value,
    references,
    ...(bound === undefined ? {} : { bound }),
  } satisfies DiscoveredSkill;
});

const outside = Effect.fnUntraced(function* (bound: SkillBound | undefined, file: string) {
  if (bound === undefined) return null;
  const fs = yield* FileSystem.FileSystem;
  const real = yield* fs.realPath(file).pipe(Effect.option);
  if (real._tag === 'None') return { path: file, reason: 'unreadable' } satisfies SkillRejection;
  return within(bound.root, real.value) ? null : ({ path: file, reason: `resolves outside ${bound.root}` } satisfies SkillRejection);
});

const within = (root: string, file: string): boolean => {
  const step = path.relative(root, file);
  return step === '' || (!step.startsWith('..') && !path.isAbsolute(step));
};

const referencesIn = Effect.fnUntraced(function* (directory: string, bound: SkillBound | undefined) {
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
    const escaped = yield* outside(bound, file);
    if (escaped !== null) return escaped;
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
    references: skill.references.map(({ name, description }) => ({ name, description })),
    instructions: () => currentBody(skill.path, skill.bound),
    reference: (name) => currentReference(skill, name),
  }));
}

const currentText = (file: string, bound: SkillBound | undefined) =>
  Effect.tryPromise({
    try: async () => {
      const real = bound === undefined ? file : await realpath(file);
      if (bound !== undefined && !within(bound.root, real)) throw new Error(`it resolves outside ${bound.root}`);
      return readFile(real, 'utf8');
    },
    catch: (cause) =>
      new AgentSkillUnreadable({ reason: `${file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });

const currentReference = Effect.fn('SkillDirectories.currentReference')(function* (skill: DiscoveredSkill, name: string) {
  if (path.basename(name) !== name) {
    return yield* new AgentSkillUnreadable({ reason: `${name} is not a reference name of ${skill.name}.` });
  }
  return yield* currentText(path.join(skill.location, REFERENCES_DIRECTORY, `${name}.md`), skill.bound);
});

const currentBody = Effect.fn('SkillDirectories.currentBody')(function* (file: string, bound: SkillBound | undefined) {
  const raw = yield* currentText(file, bound);
  const parsed = parseSkill(raw);
  if ('reason' in parsed) return yield* new AgentSkillUnreadable({ reason: `${file} cannot be loaded: ${parsed.reason}.` });
  return bound === undefined ? parsed.body : bound.render(parsed.body);
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
