import { Console, Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { resolve } from 'node:path';
import { CurrentInvocation, print, type Invocation, type VerbCommand } from '../../platform/cli/verb.js';
import type { GroupRegistry, ProjectLens as Lens, ProjectRegistry } from '../contract/service/registration.js';
import { STORAGE_MODES } from '../contract/wire/project.js';

export type PolicyCommands = ReadonlyArray<VerbCommand<Command.Environment>>;

export type ProjectsCli<Row, Removed, Policy extends PolicyCommands, Group, Left> = {
  readonly registry: ProjectRegistry<Row, Removed>;
  readonly groups: GroupRegistry<Group, Left>;
  readonly here: (at: Invocation) => Lens;
  readonly render: (rows: readonly Row[]) => string;
  readonly renderGroups: (groups: readonly Group[]) => string;
  readonly policy: Policy;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const projects = <Row, Removed, const Policy extends PolicyCommands, Group, Left>({
  registry,
  here,
  render,
  policy,
}: ProjectsCli<Row, Removed, Policy, Group, Left>) => {
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
      steps: Flag.KeyValuePair('step').pipe(
        Flag.optional,
        Flag.withMetavar('id=value'),
        Flag.withDescription('a value for a creation step this build contributes, keyed by the step id; repeat for several'),
      ),
    },
    (o) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const rootPath = resolve(at.cwd, o.path);
        const name = optional(o.name) ?? rootPath.split('/').pop() ?? rootPath;
        const storage = optional(o.storage);
        const contributed = optional(o.steps);
        yield* print(
          yield* registry.add({ name, rootPath, strictProvenance: o.strictProvenance, private: o.private, storage, contributed }, here(at)),
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

export const grouping = <Row, Removed, const Policy extends PolicyCommands, Group, Left>({
  groups,
  here,
  renderGroups,
}: ProjectsCli<Row, Removed, Policy, Group, Left>) => {
  const shown = (one: Group | null, json: boolean) =>
    json ? print(one, true) : Console.log(one === null ? 'in no group' : renderGroups([one]));

  const make = Command.make(
    'make',
    { json, name: Argument.String('name'), projects: Argument.String('name|id').pipe(Argument.atLeast(2)) },
    ({ json, name, projects }) =>
      Effect.gen(function* () {
        const made = yield* groups.make({ name, projects }, here(yield* CurrentInvocation));
        if (json) return yield* print(made, true);
        yield* Console.log(renderGroups([made.group]));
        if (made.returned) yield* Console.log('a group dissolved under this name came back with its graph');
      }),
  ).pipe(
    Command.withDescription(
      'make a group of two or more registered projects, in that order: one system with a graph of its own, each project keeping its repository, graph and law; a group dissolved under this name comes back with its graph',
    ),
  );

  const rename = Command.make('rename', { json, group: Argument.String('group'), name: Argument.String('name') }, ({ json, group, name }) =>
    Effect.gen(function* () {
      yield* shown(yield* groups.rename(group, name, here(yield* CurrentInvocation)), json);
    }),
  ).pipe(Command.withDescription('rename a group'));

  const join = Command.make(
    'join',
    { json, group: Argument.String('group'), project: Argument.String('name|id') },
    ({ json, group, project }) =>
      Effect.gen(function* () {
        yield* shown(yield* groups.join(group, project, here(yield* CurrentInvocation)), json);
      }),
  ).pipe(Command.withDescription('add a registered project to a group, after its members'));

  const leave = Command.make('leave', { json, project: Argument.String('name|id') }, ({ json, project }) =>
    Effect.gen(function* () {
      yield* print(yield* groups.leave(project, here(yield* CurrentInvocation)), json);
    }),
  ).pipe(Command.withDescription('take a project out of its group; a group left with one member dissolves'));

  const list = Command.make('list', { json }, ({ json }) =>
    Effect.gen(function* () {
      const all = yield* groups.list(here(yield* CurrentInvocation));
      if (json) return yield* print(all, true);
      yield* Console.log(renderGroups(all));
    }),
  ).pipe(Command.withDescription('the groups of projects and their members'));

  const show = Command.make(
    'show',
    {
      json,
      ref: Argument.String('name|id').pipe(Argument.optional, Argument.withDescription('a project or a group; omitted, the project here')),
    },
    ({ json, ref }) =>
      Effect.gen(function* () {
        yield* shown(yield* groups.read(optional(ref), here(yield* CurrentInvocation)), json);
      }),
  ).pipe(Command.withDescription('the group a project belongs to, or a group by its name'));

  return Command.make('group').pipe(
    Command.withDescription('groups of projects: several repositories Tagma treats as one system'),
    Command.withSubcommands([make, rename, join, leave, list, show]),
  );
};
