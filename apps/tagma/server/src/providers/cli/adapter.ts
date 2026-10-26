import { resolve } from 'node:path';
import { Console, Effect } from 'effect';
import { Argument, Command, Flag } from 'effect/cli';
import { CurrentInvocation, print } from '../../platform/cli/verb.js';
import { PROVIDER_OPERATIONS as OPS } from '../contract/wire/operations.js';
import type { AdapterState } from '../contract/wire/catalog.js';
import type { AuthCli } from './auth.js';

const json = Flag.Boolean('json').pipe(Flag.withDescription('machine-readable output'), Flag.withDefault(false));

const said = (adapter: AdapterState): string => {
  const name = `${adapter.id}${adapter.version === null ? '' : `@${adapter.version}`}`;
  switch (adapter.state) {
    case 'loaded':
      return `${name} serves ${adapter.providers.join(', ') || 'no provider'}`;
    case 'failed':
      return `${name} did not load: ${adapter.reason}`;
    case 'disabled':
      return `${name} is disabled; its providers read provider-not-installed and their credentials stay`;
  }
};

export const adapter = ({ perform, here }: AuthCli) => {
  const aimed = Effect.map(CurrentInvocation, here);
  const add = Command.make('add', { json, source: Argument.String('source') }, ({ json, source }) =>
    Effect.gen(function* () {
      const named = source.trim();
      const sent =
        named === '.' || named.startsWith('./') || named.startsWith('../') ? resolve((yield* CurrentInvocation).cwd, named) : named;
      const { adapter: installed } = yield* perform(OPS.install_adapter, { source: sent }, yield* aimed);
      if (json) return yield* print(installed, true);
      yield* Console.log(said(installed));
    }),
  ).pipe(Command.withDescription('install an adapter from an npm package, a GitHub repository or a local directory'));

  const update = Command.make('update', { json, id: Argument.String('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const { adapter: updated } = yield* perform(OPS.update_adapter, { id: id.trim() }, yield* aimed);
      if (json) return yield* print(updated, true);
      yield* Console.log(said(updated));
    }),
  ).pipe(Command.withDescription('install an adapter again from its source; runs started before keep the version they began with'));

  const remove = Command.make('remove', { json, id: Argument.String('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const removed = yield* perform(OPS.remove_adapter, { id: id.trim() }, yield* aimed);
      if (json) return yield* print(removed, true);
      yield* Console.log(`removed the adapter ${removed.id}; the credentials of its providers stay`);
    }),
  ).pipe(Command.withDescription('remove an installed adapter'));

  const disable = Command.make('disable', { json, id: Argument.String('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const { adapter: disabled } = yield* perform(OPS.disable_adapter, { id: id.trim() }, yield* aimed);
      if (json) return yield* print(disabled, true);
      yield* Console.log(said(disabled));
    }),
  ).pipe(
    Command.withDescription('stop loading an installed adapter; its providers read provider-not-installed and their credentials stay'),
  );

  const enable = Command.make('enable', { json, id: Argument.String('id') }, ({ json, id }) =>
    Effect.gen(function* () {
      const { adapter: enabled } = yield* perform(OPS.enable_adapter, { id: id.trim() }, yield* aimed);
      if (json) return yield* print(enabled, true);
      yield* Console.log(said(enabled));
    }),
  ).pipe(Command.withDescription('load a disabled adapter again'));

  return Command.make('adapter').pipe(
    Command.withDescription('install, update, disable and remove model provider adapters on this machine'),
    Command.withSubcommands([add, update, disable, enable, remove]),
  );
};
