import { basename, join, relative } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import type {
  PluginAgentFile,
  PluginCommandFile,
  PluginIgnored,
  PluginOption,
  PluginSkillFile,
  PluginUnreadable,
} from '../../plugins/contract/service/format.js';
import { declaredPath, entryOf, firstLine, frontmatterOf, namesIn, skillFolders, textOf } from '../../plugins/contract/service/reading.js';
import { type CommandParts, commandEntryOf, listed, type Manifest } from './manifest.js';
import { tagmaTool, type ToolNaming } from './tools.js';
import { contentSubstitution, substituted } from './variables.js';

const MARKDOWN = '.md';

const named = (fields: Readonly<Record<string, unknown>>, fallback: string): string => {
  const name = fields['name'];
  return typeof name === 'string' && name.length > 0 && name.length <= 256 ? name : fallback;
};

const described = (fields: Readonly<Record<string, unknown>>, body: string): string => {
  const description = fields['description'];
  return typeof description === 'string' && description.length > 0 ? description : firstLine(body);
};

const skillName = Effect.fnUntraced(function* (skill: PluginSkillFile) {
  const read = frontmatterOf(yield* textOf(skill.file));
  return 'reason' in read ? skill : { ...skill, name: named(read.fields, skill.name) };
});

const singleSkill = Effect.fnUntraced(function* (root: string, directory: string, fallback: string) {
  const file = yield* entryOf(root, join(directory, 'SKILL.md'));
  if (file.kind !== 'file') return null;
  return yield* skillName({ name: fallback, directory, file: file.path, render: (text) => text });
});

export const skillsOf = Effect.fnUntraced(function* (root: string, plugin: string, manifest: Manifest | null, ignored: PluginIgnored[]) {
  const found: PluginSkillFile[] = [];
  for (const skill of yield* skillFolders(root, 'skills', ignored)) found.push(yield* skillName(skill));
  for (const path of listed(manifest?.skills)) {
    const entry = yield* declaredPath(root, 'skills', path, ignored, true);
    if (entry === null) continue;
    if (entry.kind !== 'directory') {
      ignored.push({ component: 'skills', name: path, reason: 'a skills entry names a directory' });
      continue;
    }
    const single = yield* singleSkill(root, entry.path, entry.path === root ? plugin : basename(entry.path));
    if (single !== null) found.push(single);
    else for (const skill of yield* skillFolders(root, relative(root, entry.path), ignored)) found.push(yield* skillName(skill));
  }
  if (found.length === 0 && manifest?.skills === undefined && (yield* entryOf(root, 'skills')).kind === 'absent') {
    const single = yield* singleSkill(root, root, plugin);
    if (single !== null) found.push(single);
  }
  return found;
});

type Markdown = { readonly segments: readonly string[]; readonly path: string };

const markdownFiles: (
  root: string,
  directory: string,
  prefix: readonly string[],
) => Effect.Effect<readonly Markdown[], PluginUnreadable, FileSystem.FileSystem> = Effect.fnUntraced(function* (
  root: string,
  directory: string,
  prefix: readonly string[],
) {
  const files: Markdown[] = [];
  for (const name of yield* namesIn(directory)) {
    const entry = yield* entryOf(root, join(directory, name));
    if (entry.kind === 'directory') files.push(...(yield* markdownFiles(root, entry.path, [...prefix, name])));
    else if (entry.kind === 'file' && name.endsWith(MARKDOWN))
      files.push({ segments: [...prefix, name.slice(0, -MARKDOWN.length)], path: entry.path });
  }
  return files;
});

const fileCommand = Effect.fnUntraced(function* (name: string, path: string, options: readonly PluginOption[], description?: string) {
  const read = frontmatterOf(yield* textOf(path));
  const command: PluginCommandFile = {
    name,
    description: description ?? (('reason' in read ? '' : described(read.fields, read.body)) || name),
    body: (place) =>
      Effect.map(textOf(path), (raw) => {
        const again = frontmatterOf(raw);
        return substituted('reason' in again ? raw : again.body, place, contentSubstitution(options));
      }),
  };
  return command;
});

export const commandsOf = Effect.fnUntraced(function* (
  root: string,
  parts: CommandParts | undefined,
  options: readonly PluginOption[],
  ignored: PluginIgnored[],
) {
  const commands: PluginCommandFile[] = [];
  const places: { readonly path: string; readonly optional: boolean }[] = [];
  if (parts === undefined) places.push({ path: join(root, 'commands'), optional: true });
  for (const part of parts ?? []) {
    if (typeof part === 'string') {
      const entry = yield* declaredPath(root, 'commands', part, ignored);
      if (entry !== null) places.push({ path: entry.path, optional: false });
      continue;
    }
    for (const [name, raw] of Object.entries(part)) {
      const entry = yield* commandEntryOf(name, raw);
      if (entry.content !== undefined) {
        const content = entry.content;
        commands.push({
          name,
          description: entry.description ?? (firstLine(content) || name),
          body: (place) => Effect.succeed(substituted(content, place, contentSubstitution(options))),
        });
        continue;
      }
      const file = yield* declaredPath(root, 'command', entry.source ?? '', ignored);
      if (file === null) continue;
      if (file.kind !== 'file') {
        ignored.push({ component: 'command', name, reason: `${entry.source} is not a file` });
        continue;
      }
      commands.push(yield* fileCommand(name, file.path, options, entry.description));
    }
  }
  for (const place of places) {
    const entry = yield* entryOf(root, place.path);
    if (entry.kind === 'absent' && place.optional) continue;
    if (entry.kind === 'file' && entry.path.endsWith(MARKDOWN)) {
      commands.push(yield* fileCommand(basename(entry.path, MARKDOWN), entry.path, options));
      continue;
    }
    if (entry.kind !== 'directory') {
      ignored.push({ component: 'commands', name: relative(root, place.path), reason: 'neither a Markdown file nor a directory of them' });
      continue;
    }
    for (const file of yield* markdownFiles(root, entry.path, [])) {
      commands.push(yield* fileCommand(file.segments.join('-'), file.path, options));
    }
  }
  return commands;
});

const IGNORED_AGENT_FIELDS = ['permissionMode', 'hooks', 'mcpServers', 'initialPrompt'];

const toolList = (value: unknown): readonly string[] | null => {
  if (typeof value === 'string')
    return value
      .split(',')
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);
  if (Array.isArray(value)) return value.filter((tool): tool is string => typeof tool === 'string');
  return null;
};

const agentOf = Effect.fnUntraced(function* (
  plugin: ToolNaming,
  segments: readonly string[],
  path: string,
  options: readonly PluginOption[],
  ignored: PluginIgnored[],
) {
  const raw = yield* textOf(path);
  const read = frontmatterOf(raw);
  const fields = 'reason' in read ? {} : read.fields;
  const name = [...segments.slice(0, -1), named(fields, segments.at(-1) ?? basename(path, MARKDOWN))].join('-');
  for (const field of IGNORED_AGENT_FIELDS) {
    if (fields[field] !== undefined)
      ignored.push({ component: 'agent field', name: `${name}: ${field}`, reason: 'a plugin agent cannot carry it' });
  }
  const asked = toolList(fields['tools']);
  const denied = new Set(toolList(fields['disallowedTools']) ?? []);
  const kept = asked?.filter((tool) => !denied.has(tool));
  const mapped = kept?.map((tool) => ({ tool, own: tagmaTool(plugin, tool) }));
  if (asked === null && denied.size > 0) {
    ignored.push({
      component: 'agent field',
      name: `${name}: disallowedTools`,
      reason: 'Tagma narrows an agent by the tools it names, not by the tools it refuses',
    });
  }
  const agent: PluginAgentFile = {
    name,
    file: path,
    description: 'reason' in read ? `Agent from ${plugin.name} plugin` : described(fields, '') || `Agent from ${plugin.name} plugin`,
    prompt: (place) =>
      Effect.map(textOf(path), (text) => {
        const again = frontmatterOf(text);
        return substituted('reason' in again ? text : again.body, place, contentSubstitution(options));
      }),
    tools: mapped === undefined ? null : [...new Set(mapped.flatMap(({ own }) => (own === null ? [] : [own])))],
    dropped: mapped?.flatMap(({ tool, own }) => (own === null ? [tool] : [])) ?? [],
  };
  return agent;
});

export const agentsOf = Effect.fnUntraced(function* (
  root: string,
  plugin: ToolNaming,
  manifest: Manifest | null,
  options: readonly PluginOption[],
  ignored: PluginIgnored[],
) {
  const agents: PluginAgentFile[] = [];
  if (manifest?.agents !== undefined) {
    for (const path of listed(manifest.agents)) {
      const entry = yield* declaredPath(root, 'agents', path, ignored);
      if (entry === null) continue;
      if (entry.kind === 'directory') {
        for (const file of yield* markdownFiles(root, entry.path, []))
          agents.push(yield* agentOf(plugin, file.segments, file.path, options, ignored));
        continue;
      }
      if (entry.kind !== 'file' || !entry.path.endsWith(MARKDOWN)) {
        ignored.push({ component: 'agents', name: path, reason: 'an agents entry names a Markdown file or a directory of them' });
        continue;
      }
      agents.push(yield* agentOf(plugin, [basename(entry.path, MARKDOWN)], entry.path, options, ignored));
    }
    return agents;
  }
  const directory = yield* entryOf(root, 'agents');
  if (directory.kind !== 'directory') return agents;
  for (const file of yield* markdownFiles(root, directory.path, [])) {
    agents.push(yield* agentOf(plugin, file.segments, file.path, options, ignored));
  }
  return agents;
});
