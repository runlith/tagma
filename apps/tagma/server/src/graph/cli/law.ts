import { Console, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import { resolve } from 'node:path';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { OUTLINE_OPERATIONS } from '../contract/wire/operations/outline.js';

export type LawCli = {
  readonly perform: Perform;
  readonly lens: (at: Invocation, options: { project?: string | undefined }) => DoorLens;
  readonly writer: () => Promise<(filePath: string, section: string) => Effect.Effect<string, Error>>;
};

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(Flag.optional, Flag.withMetavar('name|id'));
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const law = ({ perform, lens, writer }: LawCli) =>
  Command.make(
    'law',
    {
      json,
      project,
      write: Flag.String('write').pipe(Flag.optional, Flag.withMetavar('path')),
    },
    ({ json, project, write }) =>
      Effect.gen(function* () {
        const at = yield* CurrentInvocation;
        const { law: section } = yield* perform(OUTLINE_OPERATIONS.read_law, {}, lens(at, { project: optional(project) }));
        const target = optional(write);
        if (target === undefined) return yield* print(section, json);
        const writeLawSection = yield* Effect.promise(writer);
        yield* Console.log(`${yield* writeLawSection(resolve(at.cwd, target), section)} ${target}`);
      }),
  ).pipe(Command.withDescription('the managed Tagma section for a project AGENTS.md'));
