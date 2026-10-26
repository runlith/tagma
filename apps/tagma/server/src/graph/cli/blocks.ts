import { Effect, Option } from 'effect';
import { Command, Flag, type Argument } from 'effect/cli';
import { noting, CurrentInvocation, print, type Invocation } from '../../platform/cli/verb.js';
import { blockLine, type BlockLine } from '../voice/lines.js';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { OUTLINE_OPERATIONS } from '../contract/wire/operations/outline.js';
import { vocabularyOf } from './vocabulary.js';

export type BlocksCli = {
  readonly perform: Perform;
  readonly here: (at: Invocation) => DoorLens;
  readonly lens: (at: Invocation, options: { project?: string | undefined }) => DoorLens;
  readonly blockRef: (name: string) => Argument.Argument<string>;
};

const readRow = (row: BlockLine & { readonly parentName?: string | null }): Record<string, unknown> => ({
  name: row.name,
  tags: row.tags,
  fields: Object.keys(row.fields).length === 0 ? undefined : row.fields,
  title: row.title,
  parentName: row.parentName ?? undefined,
  superseded: row.superseded === true ? true : undefined,
  blocked: row.blocked === true ? true : undefined,
  building: row.building === true ? true : undefined,
  deletedAt: row.deletedAt || undefined,
});

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));
const project = Flag.String('project').pipe(Flag.optional, Flag.withMetavar('name|id'));
const optional = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);

export const blocks = ({ perform, here, lens, blockRef }: BlocksCli) => {
  const vocabulary = vocabularyOf(perform);
  const disable = Command.make('disable', { json, id: blockRef('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const { block: row } = yield* perform(OUTLINE_OPERATIONS.set_rule_enabled, { blockId: id, enabled: false }, here(at));
      yield* print(json ? readRow(row) : blockLine(yield* vocabulary(here(at)), row), json);
    }),
  ).pipe(
    Command.withDescription('switch a rule off until it is enabled again'),
    noting('For right law that must not bind now; wrong law is rewritten or superseded.'),
  );

  const enable = Command.make('enable', { json, id: blockRef('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const at = yield* CurrentInvocation;
      const { block: row } = yield* perform(OUTLINE_OPERATIONS.set_rule_enabled, { blockId: id, enabled: true }, here(at));
      yield* print(json ? readRow(row) : blockLine(yield* vocabulary(here(at)), row), json);
    }),
  ).pipe(Command.withDescription('switch a rule back on'));

  const trash = Command.make('trash', { json, project }, ({ json, project }) =>
    Effect.gen(function* () {
      const aimed = lens(yield* CurrentInvocation, { project: optional(project) });
      const { blocks: rows } = yield* perform(OUTLINE_OPERATIONS.list_trash, {}, aimed);
      if (json) return yield* print(rows.map(readRow), true);
      const table = yield* vocabulary(aimed);
      yield* print(
        rows.map((row) => blockLine(table, row)),
        false,
      );
    }),
  ).pipe(Command.withDescription('trash roots — what restore_block accepts'));

  return { disable, enable, trash };
};
