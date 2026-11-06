import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { BuildStepInput } from '@runlith/tagma/plugin/protocol';
import { Effect, Layer, Schedule, Schema } from 'effect';
import { BEFORE_BUILD, type BeforeStep, BuildStepFailed, BuildSteps } from '../checkout-builds/contract/service/steps.js';
import { type BeforeBuild, StepVerdict } from '../checkout-builds/contract/wire/steps.js';
import { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import { placeAt } from '../projects/identity.js';
import { PluginHost } from '../plugin-host/contract/service/supervision.js';
import { EnabledPlugins, HostedPlugins } from '../plugins/contract/service/plugins.js';
import { PluginPoints } from '../plugins/contract/service/points.js';
import type { PluginProcessState } from '../plugins/contract/wire/rows.js';

const decodeVerdict = Schema.decodeUnknownEffect(Schema.fromJsonString(StepVerdict));

const ANSWER_SHOWN = 200;

const STARTING_ASKED_AGAIN = '1 second';

const SETTLED: ReadonlySet<PluginProcessState> = new Set(['idle', 'running', 'failed']);

type Declared = { readonly entries: BeforeBuild; readonly caller: McpToolCaller };

export const buildSteps = Layer.effect(
  BuildSteps,
  Effect.gen(function* () {
    const points = yield* PluginPoints;
    const projects = yield* Projects;
    const identification = yield* ProjectIdentification;
    const enabledPlugins = yield* EnabledPlugins;
    const hosted = yield* HostedPlugins;
    const host = yield* PluginHost;
    const declared = new Map<string, Declared>();

    yield* Effect.acquireRelease(
      points.declare(BEFORE_BUILD, ({ plugin, value, caller }) =>
        Effect.sync(() => {
          const held: Declared = { entries: value, caller };
          declared.set(plugin.id, held);
          return () => {
            if (declared.get(plugin.id) === held) declared.delete(plugin.id);
          };
        }),
      ),
      (withdraw) => Effect.sync(withdraw),
    );

    const stepOf = (plugin: string, entry: BeforeBuild[number], caller: McpToolCaller, projectId: number): BeforeStep => ({
      plugin,
      title: entry.title,
      projectId,
      ask: Effect.fn('BuildSteps.ask')(function* (input) {
        const answer = yield* caller
          .call(plugin, entry.tool, { offer: input.offer, checkout: input.checkout } satisfies BuildStepInput, {
            caller: { kind: 'tagma', projectId, reason: 'build' },
          })
          .pipe(
            Effect.map((answered) => ({ answered })),
            Effect.catchTag('McpTimedOut', () => Effect.succeed(null)),
            Effect.mapError(
              (cause) => new BuildStepFailed({ message: `${plugin} could not be asked for ${entry.title}: ${cause.message}` }),
            ),
          );
        if (answer === null) return { verdict: 'pending' as const };
        const { answered } = answer;
        const said = 'content' in answered ? (answered.content.find((part) => part.type === 'text')?.text ?? '') : '';
        if ('content' in answered && answered.isError === true) {
          return yield* new BuildStepFailed({ message: `${plugin} refused ${entry.title}: ${said.slice(0, ANSWER_SHOWN)}` });
        }
        return yield* decodeVerdict(said).pipe(
          Effect.mapError(
            () =>
              new BuildStepFailed({ message: `${plugin} answered ${entry.title} outside a step's answer: ${said.slice(0, ANSWER_SHOWN)}` }),
          ),
        );
      }),
    });

    return {
      of: Effect.fn('BuildSteps.of')(
        function* (checkout: string) {
          const here = yield* placeAt(checkout).pipe(Effect.provideService(ProjectIdentification, identification));
          const project = yield* projects.resolve(undefined, here);
          if (project === undefined) return [];
          const enabled = (yield* enabledPlugins.held(project.id))();
          const processes = yield* Effect.repeat(
            Effect.map(hosted.roots(), (roots) => enabled.flatMap((id) => (roots.has(id) ? [{ id, row: host.reading(id) }] : []))),
            {
              schedule: Schedule.spaced(STARTING_ASKED_AGAIN),
              until: (listed) => listed.every(({ row }) => row !== undefined && SETTLED.has(row.state)),
            },
          );
          const failed = processes.flatMap(({ id, row }) => (row?.state === 'failed' ? [{ id, row }] : []));
          if (failed.length > 0) {
            return yield* new BuildStepFailed({
              message: `${failed.map(({ id, row }) => `${id} is enabled here but its process failed${row.failure ? ` (${row.failure})` : ''}`).join('; ')}, so the steps it may declare before a build cannot be asked; start it again or disable it in this project`,
            });
          }
          return enabled.flatMap((plugin) => {
            const held = declared.get(plugin);
            return held === undefined ? [] : held.entries.map((entry) => stepOf(plugin, entry, held.caller, project.id));
          });
        },
        (work, checkout) =>
          Effect.mapError(
            work,
            (cause) => new BuildStepFailed({ message: `the steps before a build of ${checkout} could not be read: ${cause.message}` }),
          ),
      ),
    };
  }),
);
