import { Effect, Layer } from 'effect';
import { McpContributions, McpContributionsUnreadable } from '../mcp/contract/service/contributions.js';
import { EnabledPlugins } from './contract/service/plugins.js';
import { componentName } from './contract/wire/names.js';

export const pluginServersLayer = Layer.effect(
  McpContributions,
  Effect.gen(function* () {
    const enabled = yield* EnabledPlugins;
    return McpContributions.of({
      of: (projectId) =>
        enabled.of(projectId).pipe(
          Effect.map((plugins) =>
            plugins.flatMap((plugin) =>
              plugin.servers.map((declaration) => ({
                declaration,
                contributor: plugin.id,
                local: declaration.name.slice(componentName(plugin.id, '').length),
                redact: plugin.redact,
              })),
            ),
          ),
          Effect.mapError((failure) => new McpContributionsUnreadable({ reason: failure.reason })),
        ),
      changes: enabled.changes,
    });
  }),
);
