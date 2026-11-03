import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Effect, Layer, Schedule, Schema } from 'effect';
import { BEFORE_BUILD, type BeforeStep, BuildStepFailed, BuildSteps } from '../checkout-builds/contract/service/steps.js';
import { type BeforeBuild, StepVerdict } from '../checkout-builds/contract/wire/steps.js';
import { ProjectIdentification, Projects } from '../projects/contract/service/registry.js';
import { placeAt } from '../projects/identity.js';
import { Settings } from '../settings/contract/service/values.js';
import { TagmaAppPointRefused, TagmaAppPoints } from '../tagma-apps/contract/service/points.js';
import { tagmaAppsEnabled } from '../tagma-apps/contract/wire/settings.js';
import { TagmaApps } from '../tagma-apps/contract/service/supervision.js';

const decodeVerdict = Schema.decodeUnknownEffect(Schema.fromJsonString(StepVerdict));

const ANSWER_SHOWN = 200;

const STARTING_ASKED_AGAIN = '1 second';

type Declared = { readonly entries: BeforeBuild; readonly caller: McpToolCaller };

export const buildSteps = Layer.effect(
  BuildSteps,
  Effect.gen(function* () {
    const points = yield* TagmaAppPoints;
    const projects = yield* Projects;
    const identification = yield* ProjectIdentification;
    const settings = yield* Settings;
    const apps = yield* TagmaApps;
    const declared = new Map<string, Declared>();

    yield* Effect.acquireRelease(
      points.declare(
        BEFORE_BUILD,
        Effect.fnUntraced(function* ({ app, value, tools, caller }) {
          const served = new Set(tools?.map((descriptor) => descriptor.name));
          const missing = value.filter((entry) => !served.has(entry.tool)).map((entry) => entry.tool);
          if (missing.length > 0) {
            return yield* new TagmaAppPointRefused({
              point: BEFORE_BUILD.app.name,
              reason: `the process serves no tool ${missing.join(', ')}`,
            });
          }
          const held: Declared = { entries: value, caller };
          declared.set(app.id, held);
          return () => {
            if (declared.get(app.id) === held) declared.delete(app.id);
          };
        }),
      ),
      (withdraw) => Effect.sync(withdraw),
    );

    const stepOf = (app: string, entry: BeforeBuild[number], caller: McpToolCaller, projectId: number): BeforeStep => ({
      app,
      title: entry.title,
      projectId,
      ask: Effect.fn('BuildSteps.ask')(function* (input) {
        const answer = yield* caller
          .call(
            app,
            entry.tool,
            { offer: input.offer, checkout: input.checkout },
            { caller: { kind: 'tagma', projectId, reason: 'build' } },
          )
          .pipe(
            Effect.map((answered) => ({ answered })),
            Effect.catchTag('McpTimedOut', () => Effect.succeed(null)),
            Effect.mapError((cause) => new BuildStepFailed({ message: `${app} could not be asked for ${entry.title}: ${cause.message}` })),
          );
        if (answer === null) return { verdict: 'pending' as const };
        const { answered } = answer;
        const said = 'content' in answered ? (answered.content.find((part) => part.type === 'text')?.text ?? '') : '';
        if ('content' in answered && answered.isError === true) {
          return yield* new BuildStepFailed({ message: `${app} refused ${entry.title}: ${said.slice(0, ANSWER_SHOWN)}` });
        }
        return yield* decodeVerdict(said).pipe(
          Effect.mapError(
            () =>
              new BuildStepFailed({ message: `${app} answered ${entry.title} outside a step's answer: ${said.slice(0, ANSWER_SHOWN)}` }),
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
          const enabled = yield* settings.value(tagmaAppsEnabled, project.id);
          const rows = yield* Effect.repeat(apps.list(project.id), {
            schedule: Schedule.spaced(STARTING_ASKED_AGAIN),
            until: (listed) => !listed.some((row) => enabled.includes(row.id) && row.state === 'starting'),
          });
          const failed = rows.filter((row) => enabled.includes(row.id) && row.state === 'failed');
          if (failed.length > 0) {
            return yield* new BuildStepFailed({
              message: `${failed.map((row) => `${row.id} is enabled here but its process failed${row.failure === undefined ? '' : ` (${row.failure})`}`).join('; ')}, so the steps it may declare before a build cannot be asked; start it again or disable it in this project`,
            });
          }
          return enabled.flatMap((app) => {
            const held = declared.get(app);
            return held === undefined ? [] : held.entries.map((entry) => stepOf(app, entry, held.caller, project.id));
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
