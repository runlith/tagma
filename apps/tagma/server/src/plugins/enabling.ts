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

export const enablingIn = Effect.fnUntraced(function* (settings: Context.Service.Shape<typeof Settings>, projectId: number) {
  const enabled = yield* settings.read(pluginsEnabled, projectId);
  const off = yield* settings.value(pluginsDisabled, projectId);
  const machineOff = new Set(yield* settings.value(pluginsOff));
  const listed = new Set(enabled.value.filter((id) => !off.includes(id)));
  return {
    running: new Set([...listed].filter((id) => !machineOff.has(id))),
    listed,
    everywhere: new Set(enabled.layers.user?.value ?? []),
    own: enabled.layers.project?.value ?? [],
    off,
    machineOff,
  } satisfies Enabling;
});
