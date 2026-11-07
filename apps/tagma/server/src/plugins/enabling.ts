import { type Context, Effect } from 'effect';
import type { Settings } from '../settings/contract/service/values.js';
import { pluginsDisabled, pluginsEnabled, pluginsOff } from './contract/wire/settings.js';

export type Enabling = {
  readonly running: ReadonlySet<string>;
  readonly listed: ReadonlySet<string>;
  readonly everywhere: ReadonlySet<string>;
  readonly own: readonly string[];
  readonly off: readonly string[];
  readonly machineOff: ReadonlySet<string>;
};

export const runningOf = (enabled: readonly string[], off: readonly string[], machineOff: readonly string[]): readonly string[] =>
  enabled.filter((id) => !off.includes(id) && !machineOff.includes(id));

export const enablingIn = Effect.fnUntraced(function* (settings: Context.Service.Shape<typeof Settings>, projectId: number) {
  const enabled = yield* settings.read(pluginsEnabled, projectId);
  const off = yield* settings.value(pluginsDisabled, projectId);
  const machineOff = yield* settings.value(pluginsOff);
  return {
    running: new Set(runningOf(enabled.value, off, machineOff)),
    listed: new Set(enabled.value.filter((id) => !off.includes(id))),
    everywhere: new Set(enabled.layers.user?.value ?? []),
    own: enabled.layers.project?.value ?? [],
    off,
    machineOff: new Set(machineOff),
  } satisfies Enabling;
});
