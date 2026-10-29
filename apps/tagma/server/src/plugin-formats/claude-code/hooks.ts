import { Duration, Effect } from 'effect';
import type { PluginHook, PluginIgnored } from '../../plugins/contract/service/format.js';
import { type HookDialect, hooksOfEvents, hooksOfFile } from '../../plugins/contract/service/hooks.js';
import { declaredPath, entryOf, isObject } from '../../plugins/contract/service/reading.js';
import type { PluginHookPoint } from '../../plugins/contract/wire/rows.js';
import type { Manifest } from './manifest.js';
import { claudeInput, claudeTool, tagmaInput, type ToolNaming } from './tools.js';
import { optionEnvironment, pluginEnvironment, substituted } from './variables.js';

const EVENTS: Readonly<Record<string, PluginHookPoint>> = {
  PreToolUse: 'beforeTool',
  PostToolUse: 'afterTool',
  UserPromptSubmit: 'beforeStep',
  Stop: 'beforeClose',
  SessionStart: 'threadStarted',
  SessionEnd: 'threadEnded',
};

const timeoutOf = (event: string, declared: number | undefined): Duration.Duration =>
  declared !== undefined && declared > 0
    ? Duration.seconds(event === 'SessionEnd' ? Math.min(declared, 60) : declared)
    : event === 'UserPromptSubmit'
      ? Duration.seconds(30)
      : event === 'SessionEnd'
        ? Duration.millis(1_500)
        : Duration.seconds(600);

const dialectOf = (plugin: ToolNaming): HookDialect => ({
  span: 'claudeCode.hook',
  events: EVENTS,
  exactNames: true,
  tool: (name) => {
    const shown = claudeTool(plugin, name);
    return { shown, matched: [shown] };
  },
  toolInput: claudeInput,
  tagmaInput,
  substitute: substituted,
  environment: (place) => ({ CLAUDE_PROJECT_DIR: place.project, ...pluginEnvironment(place), ...optionEnvironment(place) }),
  timeout: timeoutOf,
  refusal: (handler, command) =>
    handler.args === undefined && command.includes('${user_config.')
      ? 'a shell command takes option values from CLAUDE_PLUGIN_OPTION_<KEY>, never ${user_config.KEY}'
      : null,
});

export const hooksOf = Effect.fnUntraced(function* (
  root: string,
  plugin: ToolNaming,
  manifest: Manifest | null,
  ignored: PluginIgnored[],
  replacing: Readonly<Record<string, unknown>> | null,
) {
  const dialect = dialectOf(plugin);
  const hooks: PluginHook[] = [];
  const standard = yield* entryOf(root, 'hooks/hooks.json');
  if (standard.kind === 'file') yield* hooksOfFile(dialect, standard.path, 'hooks/hooks.json', hooks, ignored);
  const shapes = manifest?.hooks === undefined ? [] : Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  for (const shape of shapes) {
    if (typeof shape === 'string') {
      const entry = yield* declaredPath(root, 'hooks', shape, ignored);
      if (entry?.kind === 'file') yield* hooksOfFile(dialect, entry.path, shape, hooks, ignored);
      else if (entry !== null) ignored.push({ component: 'hooks', name: shape, reason: 'not a JSON file' });
    } else if (isObject(shape)) yield* hooksOfEvents(dialect, 'plugin.json', shape, hooks, ignored);
    else ignored.push({ component: 'hooks', name: null, reason: 'a hooks entry is neither a path nor an event map' });
  }
  if (replacing === null) return hooks;
  const replaced = new Set(Object.keys(replacing).flatMap((event) => EVENTS[event] ?? []));
  const kept = hooks.filter((hook) => !replaced.has(hook.point));
  yield* hooksOfEvents(dialect, 'its marketplace entry', replacing, kept, ignored);
  return kept;
});
