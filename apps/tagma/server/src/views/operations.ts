import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { PluginActions } from './contract/service/actions.js';
import { PluginViews, ViewStorage } from './contract/service/views.js';
import { VIEW_OPERATIONS as OPS } from './contract/wire/operations.js';

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

const mountOf = (input: { readonly plugin: string; readonly view: string }) =>
  Effect.map(projectId, (project) => ({ projectId: project, plugin: input.plugin, view: input.view }));

export const VIEW_PAIRS = {
  call_plugin_tool: pair(
    OPS.call_plugin_tool,
    body(OPS.call_plugin_tool, {
      execute: Effect.fnUntraced(function* (input) {
        const mount = yield* mountOf(input);
        const result = yield* (yield* PluginViews).call(mount, input.tool, input.arguments, {
          kind: 'operator',
          projectId: mount.projectId,
          view: input.view,
          threadId: input.threadId,
        });
        return { status: 'ok' as const, result };
      }),
    }),
  ),
  run_plugin_action: pair(
    OPS.run_plugin_action,
    body(OPS.run_plugin_action, {
      execute: Effect.fnUntraced(function* (input) {
        const said = yield* (yield* PluginActions).run(yield* projectId, input.plugin, input.action);
        return { status: 'ok' as const, said };
      }),
    }),
  ),
  read_plugin_resource: pair(
    OPS.read_plugin_resource,
    body(OPS.read_plugin_resource, {
      execute: Effect.fnUntraced(function* (input) {
        const read = yield* (yield* PluginViews).read(yield* mountOf(input), input.uri);
        return { status: 'ok' as const, ...read };
      }),
    }),
  ),
  read_view_storage: pair(
    OPS.read_view_storage,
    body(OPS.read_view_storage, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'ok' as const, ...(yield* (yield* ViewStorage).get(yield* mountOf(input), input.key)) };
      }),
    }),
  ),
  write_view_storage: pair(
    OPS.write_view_storage,
    body(OPS.write_view_storage, {
      execute: Effect.fnUntraced(function* (input) {
        const stored = yield* (yield* ViewStorage).set(yield* mountOf(input), input.key, input.value);
        return { status: 'ok' as const, stored };
      }),
    }),
  ),
};
