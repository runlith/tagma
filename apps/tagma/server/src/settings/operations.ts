import { Effect } from 'effect';
import type { Caller } from '../platform/contract/wire/caller.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { pairsOf, routed, routesOf } from '../platform/contract/service/routed.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import type { ProjectCaller } from '../projects/contract/wire/project.js';
import type { SettableScope } from '../platform/contract/wire/setting.js';
import { SETTINGS_OPERATIONS as OPS, type LayerWriteAnswer, type SettingWriteAnswer, type WriteScope } from './contract/wire/operations.js';
import type { Raised } from '@runlith/agent/permissions';
import { Settings } from './contract/service/values.js';
import { DeclaredSettings, SettingDeclarations } from './contract/service/declarations.js';
import { priced } from '../platform/contract/service/start.js';

const catalog = Effect.fn('read_settings.catalog')(function* (project: { readonly id: number; readonly name: string }, section?: string) {
  const view = yield* (yield* SettingDeclarations).read(project.id);
  if (section !== undefined && !view.sections.some((part) => part.id === section)) {
    return yield* new GateRefusal('field-invalid', `no settings section is named ${section}`, [
      `name one of ${view.sections.map((part) => part.id).join(', ')}, or omit section for the whole catalog`,
    ]);
  }
  const entries = section === undefined ? view.entries : view.entries.filter((row) => row.section === section);
  return {
    status: 'ok' as const,
    project: { id: project.id, name: project.name },
    settings: {
      sections: view.sections.filter((part) => section === undefined || part.id === section),
      entries,
      rejections: view.rejections,
    },
  };
});

type CatalogAnswer = Effect.Success<ReturnType<typeof catalog>>;

const layerProject = (scope: SettableScope) =>
  Effect.flatMap(CurrentProject, (current) =>
    scope === 'project'
      ? Effect.map(current, (call): ProjectCaller['project'] | undefined => call.project)
      : current.pipe(
          Effect.map((call): ProjectCaller['project'] | undefined => call.project),
          Effect.catchIf(
            (refusal) => refusal.code === 'project-required',
            () => Effect.succeed(undefined),
          ),
        ),
  );

const pricedWrite = Effect.fnUntraced(function* <A, E, R>(projectId: number, key: string, write: Effect.Effect<A, E, R>) {
  const moves = (yield* DeclaredSettings).keys.find((one) => one.id === key)?.shapesStart;
  return yield* priced(moves === undefined ? null : { projectId, moves, quiet: false }, write);
});

const SETTINGS_ROUTED = {
  read_settings: routed(OPS.read_settings, {
    execute: Effect.fnUntraced(function* (input) {
      const call = yield* yield* CurrentProject;
      return yield* catalog(call.project, input.section);
    }),
    answer: (raw: CatalogAnswer) => raw,
  }),

  write_setting: routed(OPS.write_setting, {
    prepare: Effect.fn('write_setting.scope')(function* (input, caller: Caller) {
      const call = yield* yield* CurrentProject;
      const entry = (yield* DeclaredSettings).keys.find((row) => row.id === input.key);
      const scopes = entry?.scopes;
      const consents: readonly Raised[] =
        entry?.operatorOnly === true && caller.actor.kind !== 'operator'
          ? [
              {
                condition: 'operator-choice',
                fact: `${entry.id} is the operator's own choice, and this call ${input.value === undefined ? 'clears it' : `sets it to ${JSON.stringify(input.value)}`}`,
              },
            ]
          : [];
      return { project: call.project.name, machine: scopes !== undefined && !scopes.includes('project'), consents } satisfies WriteScope;
    }),
    execute: Effect.fnUntraced(function* (input: typeof OPS.write_setting.input.Type) {
      const call = yield* yield* CurrentProject;
      const written = yield* pricedWrite(
        call.project.id,
        input.key,
        (yield* Settings).write({
          projectId: call.project.id,
          key: input.key,
          value: input.value,
        }),
      );
      const key = (yield* DeclaredSettings).keys.find((one) => one.id === input.key)!;
      const resolved = yield* (yield* Settings).read(key, call.project.id);
      return {
        status: 'ok' as const,
        project: { id: call.project.id, name: call.project.name },
        key: key.id,
        value: resolved.value,
        from: resolved.from,
        start: written.start,
      };
    }),
    answer: (raw: SettingWriteAnswer) => raw,
  }),

  write_setting_layer: routed(OPS.write_setting_layer, {
    prepare: Effect.fnUntraced(function* (input, caller: Caller) {
      const project = yield* layerProject(input.scope);
      const consents: readonly Raised[] =
        caller.actor.kind === 'thread'
          ? [
              {
                condition: 'setting-layer',
                fact: `this call writes ${input.key} at the operator's ${input.scope} layer, the one the settings surface writes`,
              },
            ]
          : [];
      return { project: project?.name ?? null, machine: input.scope === 'user', consents } satisfies WriteScope;
    }),
    execute: Effect.fnUntraced(function* (input) {
      const project = yield* layerProject(input.scope);
      const write = (yield* Settings).write({
        scope: input.scope,
        projectId: project?.id,
        key: input.key,
        value: input.value,
        declined: input.declined,
      });
      if (project === undefined) {
        yield* write;
        return { status: 'written' as const };
      }
      const written = yield* pricedWrite(project.id, input.key, write);
      return { ...(yield* catalog(project)), start: written.start };
    }),
    answer: (raw: LayerWriteAnswer) => raw,
  }),
};

export const SETTINGS_PAIRS = pairsOf(SETTINGS_ROUTED);
export const SETTINGS_ROUTES = routesOf(SETTINGS_ROUTED);
