import type { CredentialFileFault } from '@runlith/credential-file/failure';
import { Effect, Schema } from 'effect';
import {
  type PluginLaunchEnvironment,
  PluginLaunchRefused,
  PluginLaunches,
  type PluginLaunchRequest,
} from '../plugins/contract/service/launch.js';
import type { PluginPoint } from '../plugins/contract/service/points.js';
import { Plugins } from '../plugins/contract/service/supervision.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginSecrets, type SecretTarget } from './contract/service/secrets.js';
import { SECRET_VALUE_MAX, SECRETS_POINT, SecretEntries, type SecretEntry } from './contract/wire/entries.js';
import type { PluginSecretSet, SecretRow } from './contract/wire/rows.js';
import type { SecretStore } from './store.js';

const isEntries = Schema.is(SecretEntries);
const unreadable = () =>
  new GateRefusal('secret-store-failed', 'The plugin secret store could not be read or written.', [
    'make the file plugin-secrets.json in the server’s data directory readable and writable to the server, then repeat',
  ]);
const unavailable = () =>
  new GateRefusal('secret-store-unavailable', 'This server keeps no home directory, so it has nowhere to keep a secret.', [
    'run the server with a data directory',
  ]);
const unknown = (target: SecretTarget) =>
  new GateRefusal(
    'plugin-secret-unknown',
    `The plugin ${target.plugin} declares no secret ${target.name}, or is not installed and enabled.`,
    [
      'declare it in contributes.secrets of plugin.json, install and enable the plugin, let it start, then set it',
      'read_plugin_secrets names what each plugin declares',
    ],
  );
const invalid = (reason: string) =>
  new GateRefusal('secret-value-invalid', reason, [`give a non-empty value of at most ${SECRET_VALUE_MAX} characters without a NUL`]);
const maskedForms = (value: string): readonly string[] => {
  const escaped = JSON.stringify(value).slice(1, -1);
  return escaped === value ? [value] : [value, escaped];
};
const rowOf = (entry: SecretEntry, set: boolean): SecretRow => ({ name: entry.name, description: entry.description, set });
const NOTHING: PluginLaunchEnvironment = { env: {}, redact: [] };
const SECRETS_UNREADABLE = 'the plugin secret store could not be read, so its process does not start without its secrets';

export const makeShelf = Effect.fnUntraced(function* (input: { readonly store: SecretStore | null }) {
  const { store } = input;
  const plugins = yield* Plugins;
  const launches = yield* PluginLaunches;
  const declared = new Map<string, SecretEntries>();

  const entryOf = Effect.fnUntraced(function* (target: SecretTarget) {
    const rows = yield* plugins.list(target.projectId);
    const standing = rows.find((row) => row.id === target.plugin)?.installed?.enabled === true;
    return standing ? declared.get(target.plugin)?.find((candidate) => candidate.name === target.name) : undefined;
  });
  const keep = Effect.fnUntraced(function* (plugin: string, written: Effect.Effect<boolean, CredentialFileFault>) {
    if (yield* written.pipe(Effect.mapError(unreadable))) yield* launches.changed(plugin);
  }, Effect.uninterruptible);

  return {
    ...PluginSecrets.of({
      read: Effect.fn('PluginSecrets.read')(function* (projectId) {
        const rows = yield* plugins.list(projectId);
        const held = store === null ? null : yield* store.all().pipe(Effect.mapError(unreadable));
        const sets: PluginSecretSet[] = [];
        for (const row of rows) {
          const entries = row.installed?.enabled === true ? declared.get(row.id) : undefined;
          if (entries === undefined || entries.length === 0) continue;
          const values = held?.plugins[row.id] ?? {};
          const secrets = entries.map((entry) => rowOf(entry, (values[entry.name] ?? '') !== ''));
          sets.push({ plugin: row.id, title: row.title ?? row.id, secrets, missing: secrets.filter((secret) => !secret.set).length });
        }
        return sets;
      }),
      set: Effect.fn('PluginSecrets.set')(function* (target, value) {
        const entry = yield* entryOf(target);
        if (entry === undefined) return yield* unknown(target);
        if (value === '') return yield* invalid('A secret takes a value; to take its value away, remove it.');
        if (value.length > SECRET_VALUE_MAX) return yield* invalid(`A secret value takes at most ${SECRET_VALUE_MAX} characters.`);
        if (value.includes('\0')) return yield* invalid('A secret value cannot hold a NUL character.');
        if (store === null) return yield* unavailable();
        yield* keep(target.plugin, store.set(target.plugin, target.name, value));
        return rowOf(entry, true);
      }),
      remove: Effect.fn('PluginSecrets.remove')(function* (target) {
        if (store === null) return yield* unavailable();
        const entry = yield* entryOf(target);
        const kept = (yield* store.of(target.plugin).pipe(Effect.mapError(unreadable)))[target.name] !== undefined;
        if (entry === undefined && !kept) return yield* unknown(target);
        yield* keep(target.plugin, store.remove(target.plugin, target.name));
        return { name: target.name, description: entry?.description ?? '', set: false };
      }),
    }),
    point: {
      name: SECRETS_POINT,
      owner: 'plugin-secrets',
      schema: SecretEntries,
      register: () => Effect.succeed(() => undefined),
    } satisfies PluginPoint<SecretEntries>,
    provide: Effect.fn('PluginSecrets.provide')(function* (request: PluginLaunchRequest) {
      const entries = request.contributes[SECRETS_POINT];
      if (entries === undefined) {
        declared.delete(request.plugin);
        return NOTHING;
      }
      if (!isEntries(entries))
        return yield* new PluginLaunchRefused({ reason: 'the secrets the plugin declares are not a list of secrets' });
      declared.set(request.plugin, entries);
      if (store === null || entries.length === 0) return NOTHING;
      const held = yield* store.of(request.plugin).pipe(Effect.mapError(() => new PluginLaunchRefused({ reason: SECRETS_UNREADABLE })));
      const given = entries.flatMap(({ name }) => {
        const value = held[name];
        return value === undefined || value === '' ? [] : [[name, value] as const];
      });
      return { env: Object.fromEntries(given), redact: given.flatMap(([, value]) => maskedForms(value)) };
    }),
  };
});
