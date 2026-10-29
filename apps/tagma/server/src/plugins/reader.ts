import { MCP_SERVER_NAME_PATTERN } from '@runlith/mcp/declaration';
import { Data, Effect, type FileSystem } from 'effect';
import {
  type PluginClaim,
  type PluginFormat,
  type PluginPackage,
  PluginRefused,
  type PluginUnreadable,
} from './contract/service/format.js';
import { componentName, PLUGIN_ID_PATTERN, pluginIdOf } from './contract/wire/names.js';
import type { PluginDeclared, PluginManifest } from './contract/wire/rows.js';

export class NamesCollide extends Data.TaggedError('NamesCollide')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type Read = { readonly id: string; readonly format: string; readonly package: PluginPackage };

export type Named = { readonly kind: string; readonly name: string; readonly from: string };

export const namesOf = (id: string, read: PluginPackage): readonly Named[] => [
  ...read.skills.map((skill) => ({ kind: 'skill', name: componentName(id, skill.name), from: `skill ${skill.name}` })),
  ...read.commands.map((command) => ({ kind: 'skill', name: componentName(id, command.name), from: `command ${command.name}` })),
  ...read.servers.map((server) => ({ kind: 'mcp-server', name: componentName(id, server.name), from: `MCP server ${server.name}` })),
  ...read.agents.map((agent) => ({ kind: 'agent', name: componentName(id, agent.name), from: `agent ${agent.name}` })),
];

export const collision = (named: readonly Named[]): string | null => {
  const seen = new Map<string, Named>();
  for (const entry of named) {
    const key = `${entry.kind}:${entry.name}`;
    const standing = seen.get(key);
    if (standing !== undefined) return `${standing.from} and ${entry.from} are both offered as ${entry.name}`;
    seen.set(key, entry);
  }
  return null;
};

const claimOf = Effect.fnUntraced(function* (formats: readonly PluginFormat[], root: string, manifest: PluginManifest | undefined) {
  if (manifest !== undefined) {
    const format = formats.find((candidate) => candidate.id === manifest.format);
    if (format === undefined) {
      return yield* new PluginRefused({
        reason: `its marketplace entry declares a ${manifest.format} manifest, a format Tagma does not read`,
      });
    }
    return { format, claim: (yield* format.claim(root)) ?? ('layout' as const) };
  }
  let layout: { readonly format: PluginFormat; readonly claim: PluginClaim } | null = null;
  for (const format of formats) {
    const claim = yield* format.claim(root);
    if (claim === 'manifest') return { format, claim };
    if (claim === 'layout' && layout === null) layout = { format, claim };
  }
  return layout;
});

export const readPlugin = Effect.fn('plugins.read')(function* (
  formats: readonly PluginFormat[],
  root: string,
  declared: PluginDeclared | null,
): Effect.fn.Return<Read, PluginRefused | PluginUnreadable | NamesCollide, FileSystem.FileSystem> {
  const claimed = yield* claimOf(formats, root, declared?.manifest);
  if (claimed === null) {
    return yield* new PluginRefused({ reason: `${root} holds no plugin manifest and none of the plugin layout's components` });
  }
  const entry = declared === null ? null : { name: declared.name, fields: declared.manifest?.fields ?? null };
  const read = yield* claimed.format.read(root, claimed.claim, entry);
  const id = pluginIdOf(read.name);
  if (!PLUGIN_ID_PATTERN.test(id) || id.length > 64) {
    return yield* new PluginRefused({
      reason: `the plugin name ${read.name} cannot name its components: Tagma takes lowercase letters, digits, - and _ (a . is read as -)`,
    });
  }
  const ignored = [...read.ignored];
  const servers = read.servers.filter((server) => {
    if (MCP_SERVER_NAME_PATTERN.test(componentName(id, server.name))) return true;
    ignored.push({
      component: 'mcp-server',
      name: server.name,
      reason: `${componentName(id, server.name)} is not a valid MCP server name`,
    });
    return false;
  });
  const kept = { ...read, servers, ignored };
  const collided = collision(namesOf(id, kept));
  if (collided !== null) return yield* new NamesCollide({ reason: `In ${read.name}, ${collided}.` });
  return { id, format: claimed.format.id, package: kept };
});
