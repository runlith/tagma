import { Effect, Semaphore } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AdapterInstances } from '../contract/service/instances.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import { normalize, publicValues, settingsValues } from './settingValues.js';

const settingsOf = Effect.fnUntraced(function* (adapter: string) {
  const settings = (yield* (yield* ProviderRegistry).catalog).settings.get(adapter);
  if (settings === undefined)
    return yield* new GateRefusal('unknown-adapter', `No installed adapter "${adapter}" declares settings.`, [
      'name an adapter that declares settings',
    ]);
  return settings;
});

const invalid = (reason: string) => new GateRefusal('instance-invalid', reason, ['correct the settings and save them again']);

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'instance';

const idFor = (adapter: string, name: string, taken: ReadonlySet<string>): string => {
  const base = `${adapter}-${slug(name)}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
};

const unknownInstance = (adapter: string, id: string) =>
  new GateRefusal('unknown-instance', `The adapter ${adapter} holds no instance "${id}".`, ['name one of the instances the settings list']);

export type InstanceSave = {
  readonly adapter: string;
  readonly id?: string | undefined;
  readonly revision?: string | undefined;
  readonly values?: Readonly<Record<string, unknown>> | undefined;
};

const gate = Semaphore.makeUnsafe(1);

export const saveInstance = (input: InstanceSave) =>
  gate.withPermits(1)(
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;
      const instances = yield* AdapterInstances;
      const settings = yield* settingsOf(input.adapter);
      const { instances: held, secrets: hidden } = yield* instances.read();
      const kept = (held.get(input.adapter) ?? []).find((instance) => instance.id === input.id);
      if (input.id !== undefined && kept === undefined) return yield* unknownInstance(input.adapter, input.id);
      if (input.values === undefined && kept === undefined) return yield* invalid('Give the values of a new instance.');
      if (kept !== undefined && kept.revision !== input.revision)
        return yield* new GateRefusal('stale-instance', 'These settings changed since they were read.', [
          'read the instance again before saving',
        ]);
      const secrets = input.id === undefined ? {} : (hidden[input.id] ?? {});
      const normalized =
        input.values === undefined && kept !== undefined
          ? { values: kept.values, secrets }
          : normalize(settings.fields, input.values ?? {}, secrets);
      if ('problem' in normalized) return yield* invalid(normalized.problem);
      const problem = settings.validate?.(settingsValues(settings.fields, normalized.values, normalized.secrets)) ?? null;
      if (problem !== null) return yield* invalid(problem);
      const name = normalized.values[settings.name];
      const taken = new Set([...held.values()].flatMap((list) => list.map((instance) => instance.id)));
      for (const provider of registry.current().models.providers) taken.add(provider.id);
      const id = input.id ?? idFor(input.adapter, typeof name === 'string' ? name : '', taken);
      const instance = yield* instances.save(
        input.adapter,
        { id, values: normalized.values, revision: input.revision },
        normalized.secrets,
      );
      yield* registry.reload;
      return instance;
    }),
  );

export const removeInstance = (adapter: string, id: string) =>
  gate.withPermits(1)(
    Effect.gen(function* () {
      const instances = yield* AdapterInstances;
      const registry = yield* ProviderRegistry;
      yield* settingsOf(adapter);
      if (!((yield* instances.read()).instances.get(adapter) ?? []).some((instance) => instance.id === id))
        return yield* unknownInstance(adapter, id);
      yield* instances.remove(adapter, id);
      yield* registry.reload;
    }),
  );

export type ModelListing = {
  readonly adapter: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly id?: string | undefined;
  readonly revision?: string | undefined;
};

export const listModels = Effect.fn('providers.listModels')(function* (input: ModelListing) {
  const settings = yield* settingsOf(input.adapter);
  if (settings.discover === undefined)
    return yield* new GateRefusal('discovery-failed', `The adapter ${input.adapter} cannot list models.`, ['enter the models by hand']);
  const instances = yield* AdapterInstances;
  const snapshot = input.id === undefined ? undefined : yield* instances.read();
  const kept = snapshot?.instances.get(input.adapter)?.find((instance) => instance.id === input.id);
  if (input.id !== undefined && kept === undefined) return yield* unknownInstance(input.adapter, input.id);
  if (kept !== undefined && kept.revision !== input.revision)
    return yield* new GateRefusal('stale-instance', 'These settings changed since they were read.', [
      'read the instance again before listing models',
    ]);
  const stored = input.id === undefined ? {} : (snapshot?.secrets[input.id] ?? {});
  const normalized = normalize(settings.fields, input.values, stored, false);
  if ('problem' in normalized) return yield* invalid(normalized.problem);
  const listed = yield* Effect.mapError(
    settings.discover(normalized.values, normalized.secrets),
    (failure) => new GateRefusal('discovery-failed', failure.message, ['check the address and the secret settings, then list again']),
  );
  const fields = settings.fields.find((field) => field.type === 'rows' && field.discoverable === true);
  return fields?.type === 'rows' && fields.secret !== true ? listed.map((row) => publicValues(fields.fields, row)) : [];
});
