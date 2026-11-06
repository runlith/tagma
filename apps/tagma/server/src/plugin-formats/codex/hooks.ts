import { Duration, Effect } from 'effect';
import type { PluginHook, PluginIgnored, PluginPlace } from '../../plugins/contract/service/format.js';
import { type HookDialect, hooksOfEvents, hooksOfFile } from '../../plugins/contract/service/hooks.js';
import { declaredPath, entryOf, isObject } from '../../plugins/contract/service/reading.js';
import type { HookPoint } from '@runlith/tagma/plugin/protocol';

const EVENTS: Readonly<Record<string, HookPoint>> = {
  PreToolUse: 'beforeTool',
  PostToolUse: 'afterTool',
  UserPromptSubmit: 'beforeStep',
  Stop: 'beforeClose',
  SessionStart: 'threadStarted',
  SessionEnd: 'threadEnded',
};

const VARIABLE = /\$\{(PLUGIN_ROOT|PLUGIN_DATA|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)\}/gu;

const SERVER_TOOL = /^mcp__(.+?)__(.+)$/u;

const EDITS = ['apply_patch', 'Edit', 'Write'];

export type Plugin = { readonly name: string; readonly id: string };

const toolNames = (plugin: Plugin, tool: string) => {
  if (tool === 'bash') return { shown: 'Bash', matched: ['Bash'] };
  if (tool === 'write' || tool === 'edit') return { shown: 'apply_patch', matched: EDITS };
  const server = SERVER_TOOL.exec(tool);
  if (server?.[1] !== undefined && server[1].startsWith(`${plugin.id}-`)) {
    const shown = `mcp__${server[1].slice(plugin.id.length + 1)}__${server[2]}`;
    return { shown, matched: [shown] };
  }
  return { shown: tool, matched: [tool] };
};

const timeoutOf = (event: string, declared: number | undefined): Duration.Duration =>
  event === 'SessionEnd'
    ? declared !== undefined && declared > 0
      ? Duration.seconds(Math.min(declared, 3))
      : Duration.seconds(1)
    : Duration.seconds(declared !== undefined && declared > 0 ? declared : 600);

const environmentOf = (place: PluginPlace): Readonly<Record<string, string>> => ({
  PLUGIN_ROOT: place.root,
  PLUGIN_DATA: place.data,
  CLAUDE_PLUGIN_ROOT: place.root,
  CLAUDE_PLUGIN_DATA: place.data,
});

const dialectOf = (plugin: Plugin): HookDialect => ({
  span: 'codex.hook',
  events: EVENTS,
  exactNames: false,
  tool: (tool) => toolNames(plugin, tool),
  toolInput: (_tool, input) => input,
  tagmaInput: (_tool, input) => input,
  substitute: (text, place) => text.replaceAll(VARIABLE, (_whole, name: string) => (name.endsWith('ROOT') ? place.root : place.data)),
  environment: environmentOf,
  timeout: timeoutOf,
  refusal: (handler) => (handler.args === undefined ? null : 'a Codex hook is one shell command, with no separate args'),
});

export const hooksOf = Effect.fnUntraced(function* (root: string, plugin: Plugin, declared: unknown, ignored: PluginIgnored[]) {
  const dialect = dialectOf(plugin);
  const hooks: PluginHook[] = [];
  if (declared === undefined) {
    const standard = yield* entryOf(root, 'hooks/hooks.json');
    if (standard.kind === 'file') yield* hooksOfFile(dialect, standard.path, 'hooks/hooks.json', hooks, ignored);
    return hooks;
  }
  for (const shape of Array.isArray(declared) ? declared : [declared]) {
    if (typeof shape === 'string') {
      const entry = yield* declaredPath(root, 'hooks', shape, ignored);
      if (entry?.kind === 'file') yield* hooksOfFile(dialect, entry.path, shape, hooks, ignored);
      else if (entry !== null) ignored.push({ component: 'hooks', name: shape, reason: 'not a JSON file' });
    } else if (isObject(shape)) {
      yield* hooksOfEvents(dialect, 'its plugin manifest', isObject(shape['hooks']) ? shape['hooks'] : shape, hooks, ignored);
    } else ignored.push({ component: 'hooks', name: null, reason: 'a hooks entry is neither a path nor an event map' });
  }
  return hooks;
});
