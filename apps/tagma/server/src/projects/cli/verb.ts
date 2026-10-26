import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { resolve } from 'node:path';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import type { ProjectLens as Lens, ProjectRegistry } from '../contract/service/registration.js';
import { STORAGE_MODES } from '../contract/wire/project.js';

export type ProjectsCli<Row, Removed, Policy extends ReadonlyArray<Command.Command.Any>> = {
  readonly registry: ProjectRegistry<Row, Removed>;
  readonly here: (at: Invocation) => Lens;
  readonly render: (rows: readonly Row[]) => string;
  readonly policy: Policy;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const projects = <Row, Removed, const Policy extends ReadonlyArray<Command.Command.Any>>({
  registry,
  here,
  render,
  policy,
}: ProjectsCli<Row, Removed, Policy>) => {
  const add = Command.make(
    'add',
    {
      json,
      path: Argument.String('path'),
      name: Flag.String('name').pipe(Flag.optional, Flag.withMetavar('name'), Flag.withDescription('defaults to the root directory name')),
      strictProvenance: Flag.Boolean('strict-provenance').pipe(
        Flag.withDefault(false),
        Flag.withDescription('every task here carries its origin: the spec it implements or the block it was discovered from'),
      ),
      private: Flag.Boolean('private').pipe(
        Flag.withDefault(false),
        Flag.withDescription('Tagma writes nothing into this checkout: skill, hooks and law stand at the user level'),
      ),
      storage: Flag.Literals('storage', STORAGE_MODES).pipe(
        Flag.optional,
        Flag.withDescription('where the graph files live: stealth (shadow git, default) or team (the project repo)'),
      ),
      graphRemote: Flag.String('graph-remote').pipe(
        Flag.optional,
        Flag.withMetavar('remote'),
        Flag.withDescription(
          'the private git remote of the stealth graph: a graph it holds is restored here, an empty one receives this graph',
        ),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const rootPath = resolve(at.cwd, o.path);
        const name = optional(o.name) ?? rootPath.split('/').pop() ?? rootPath;
        const storage = optional(o.storage);
        const graphRemote = optional(o.graphRemote);
        yield* print(
          yield* registry.add({ name, rootPath, strictProvenance: o.strictProvenance, private: o.private, storage, graphRemote }, here(at)),
          o.json,
        );
      }),
  ).pipe(
    Command.withDescription(
      'register a root, keyed by its repository — one project per repository, and a removed one comes back as it was; subtrees are read with --scope',
    ),
  );

  const setRoot = Command.make(
    'set-root',
    { json, ref: Argument.String('name|id'), path: Argument.String('path') },
    ({ json, ref, path }) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        yield* print(yield* registry.move(ref, resolve(at.cwd, path), here(at)), json);
      }),
  ).pipe(Command.withDescription('the repository moved: point the project at the checkout it lives in now'));

  const remove = Command.make(
    'remove',
    {
      json,
      ref: Argument.String('name|id'),
      unlink: Flag.Boolean('unlink').pipe(
        Flag.withDefault(false),
        Flag.withDescription('first unlink every edge other projects of this machine hold into its graph'),
      ),
    },
    ({ json, ref, unlink }) =>
      Effect.gen(function* () {
        yield* print(yield* registry.remove({ ref, unlink }, here(yield* CurrentInvocation)), json);
      }),
  ).pipe(
    Command.withDescription(
      'take a project out of the registry, deleting nothing on disk — adding its folder again brings it back with its graph and threads; the answer counts the edges other projects hold into its graph',
    ),
  );

  const list = Command.make('list', { json }, ({ json }) =>
    Effect.gen(function* () {
      const rows = yield* registry.list(here(yield* CurrentInvocation));
      if (json) return yield* print(rows, true);
      yield* Console.log(render(rows));
    }),
  ).pipe(Command.withDescription('registered projects'));

  const show = Command.make('show', { json, ref: Argument.String('name|id') }, ({ json, ref }) =>
    Effect.gen(function* () {
      const row = yield* registry.read(ref, here(yield* CurrentInvocation));
      if (json) return yield* print(row, true);
      yield* Console.log(render([row]));
    }),
  ).pipe(Command.withDescription('one project: its identity, its checkout and what it is configured to be'));

  return Command.make('project').pipe(
    Command.withDescription('the project registry: which checkouts are graphs'),
    Command.withSubcommands([add, setRoot, remove, list, show, ...policy]),
  );
};
