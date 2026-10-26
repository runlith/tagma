import { join } from 'node:path';
import { Console, Effect, Option } from 'effect';
import { WORKFLOWS_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { Argument, Command, Flag } from 'effect/cli';
import { end, noting, print, type Invocation } from '../../platform/cli/verb.js';
import type { WorkflowCatalog, WorkflowRun, WorkflowStarted } from '../contract/wire/workflows.js';

type Lens = { readonly cwd?: string; readonly project?: string };

export type WorkflowsDoor = {
  readonly operations: {
    readonly perform: (request: {
      readonly params: { readonly id: string };
      readonly query: Lens;
      readonly headers: {};
      readonly payload: unknown;
    }) => Effect.Effect<unknown, unknown>;
  };
};

const performing = <A>(door: WorkflowsDoor, id: string, query: Lens, payload: unknown): Effect.Effect<A, unknown> =>
  Effect.map(door.operations.perform({ params: { id }, query, headers: {}, payload }), (answer) => {
    const { status: _, ...value } = answer as { readonly status: string } & Record<string, unknown>;
    return value as A;
  });

export type WorkflowsCli = {
  readonly ask: <A>(call: (door: WorkflowsDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly lens: (at: Invocation, options: { project?: string | undefined }) => Lens;
  readonly blockRefFlag: (name: string) => Flag.Flag<string>;
  readonly dataPath: string | null;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(
  Flag.optional,
  Flag.withMetavar('name|id'),
  Flag.withDescription('defaults to the project whose root contains the cwd'),
);
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

const parsedInput = (text: string): Record<string, unknown> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

export const workflow = ({ ask, lens, blockRefFlag, dataPath }: WorkflowsCli) => {
  const workflowList = Command.make('list', { json, project }, (o) =>
    Effect.gen(function* () {
      const catalog = yield* ask((door, at) =>
        performing<WorkflowCatalog>(door, 'list_workflows', lens(at, { project: optional(o.project) }), {}),
      );
      if (o.json) return yield* print(catalog, true);
      for (const entry of catalog.resolved) {
        yield* Console.log(`${entry.name} [${entry.floor}] ${entry.description}`);
        for (const [field, said] of Object.entries(entry.input)) yield* Console.log(`  ${field}: ${said}`);
      }
      for (const entry of catalog.rejected) yield* Console.error(`${entry.name} [${entry.floor}] is not usable: ${entry.reason}`);
    }),
  ).pipe(Command.withDescription('the workflows this project can run by name, and the files that could not become one'));

  const workflowRuns = Command.make('runs', { json, project }, (o) =>
    Effect.gen(function* () {
      const { runs } = yield* ask((door, at) =>
        performing<{ readonly runs: ReadonlyArray<WorkflowRun> }>(
          door,
          'list_workflow_runs',
          lens(at, { project: optional(o.project) }),
          {},
        ),
      );
      if (o.json) return yield* print(runs, true);
      for (const run of runs) {
        const walked = run.steps.map((step) => `${step.stepId}:${step.status}`).join(' → ');
        yield* Console.log(`${run.id} ${run.workflow} [${run.status}] ${walked}${run.reason ? ` — ${run.reason}` : ''}`);
      }
    }),
  ).pipe(Command.withDescription('the workflow runs of this project, freshest first'));

  const workflowRun = Command.make(
    'run',
    {
      json,
      project,
      name: Argument.String('name').pipe(Argument.withDescription('the saved workflow to run')),
      input: Flag.String('input').pipe(
        Flag.withMetavar('json'),
        Flag.withDescription('the arguments, as one JSON object of the fields the workflow declares'),
      ),
      scope: blockRefFlag('scope').pipe(Flag.optional, Flag.withDescription("the block whose subtree the run's thread is opened inside")),
    },
    (o) =>
      Effect.gen(function* () {
        const input = parsedInput(o.input);
        if (input === null) {
          yield* Console.error('--input is one JSON object of the arguments this workflow declares');
          return end(1);
        }
        const scopeName = optional(o.scope);
        const started = yield* ask((door, at) =>
          performing<WorkflowStarted>(door, 'start_workflow', lens(at, { project: optional(o.project) }), {
            name: o.name,
            input,
            scopeName,
          }),
        );
        if (o.json) return yield* print(started, true);
        yield* Console.log(`${started.runId} runs in thread ${started.threadId}`);
      }),
  ).pipe(Command.withDescription('start a saved workflow; its members work under a thread of its own'));

  return Command.make('workflow', { json, project }, (o) =>
    Effect.gen(function* () {
      const catalog = yield* ask((door, at) =>
        performing<WorkflowCatalog>(door, 'list_workflows', lens(at, { project: optional(o.project) }), {}),
      );
      yield* print(o.json ? catalog : catalog.resolved.map((entry) => entry.name).join('\n'), o.json);
    }),
  ).pipe(
    Command.withSubcommands([workflowList, workflowRuns, workflowRun]),
    Command.withDescription('saved compositions of agents: what this project can run, and running one'),
    noting(`A workflow is a definition on a floor — \`<project>/.tagma/workflows\` or
\`${dataPath === null ? WORKFLOWS_DIRECTORY : join(dataPath, WORKFLOWS_DIRECTORY)}\` — and a project's file shadows the person's of the same
name. \`run\` opens a thread for the composition, starts it and leaves the
server driving it: its members are that thread's children, so the app shows
every one of them working. A driver that dies leaves the ledger, and the run
is picked up where its records say it stopped.`),
  );
};
