import { Cause, Clock, Effect, Option, Stream } from 'effect';
import { DefaultLogins } from '../../providers/accounts/defaultLogins.js';
import { keptSwitches, type ModelSwitch, type ModelSwitches } from '@runlith/llm/models/description';
import type { ModelCatalog, ModelOption } from '@runlith/llm/models/catalog';
import { ThreadCallBroke, ThreadMissing } from '@runlith/agent/thread/ThreadBorder';
import { ThreadModelRefused } from '@runlith/agent/collaboration/model';
import {
  ThreadDeliveryConflict,
  ThreadRunConflict,
  ThreadRunLost,
  ThreadRunRefused,
  type ThreadRunsFailure,
  ThreadRunUnavailable,
} from '@runlith/agent/collaboration/runs';
import { profileModel } from '@runlith/agent/collaboration/modelChoice';
import { callRung } from '@runlith/llm/models/resolve';
import { planeRefusalOf } from '@runlith/agent/collaboration/planeRefusal';
import { CredentialFileFailed, CredentialFileInvalid } from '@runlith/credential-file/failure';
import { TokenStoreFailed, type TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import {
  type DefaultModel,
  ProviderRegistry,
  defaultModelOf,
  notInstalled,
  servedTextModel,
} from '../../providers/contract/service/registry.js';
import { DefaultAccounts, ProviderAccounts, storedKeys, unknownAccount } from '../../providers/contract/service/accounts.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ModelMemory, ModelPreferenceRows } from './preferences.js';
import { textModelOf } from './spendability.js';
import { modelPreference } from '../store/preferences.js';
import { defaultAccount } from '../../providers/store/tables.js';
import type { ModelDefaults, RememberedSwitches, ThreadModelSettings } from '../contract/wire/modelSelection.js';
import type { ModelPreference } from '../../threads/contract/wire/birth.js';
import { BirthModelSelection } from '../../threads/contract/service/birth.js';
import { ModelPreferences } from '../contract/service/models.js';
import { gated } from '../../threads/projectGate.js';
import { ThreadLookup } from '../../threads/contract/service/reads.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { HarnessMoves, HarnessRegistry } from '../../threads/contract/service/harness.js';
import { ThreadList } from '../../threads/contract/service/list.js';
import { ThreadRollouts } from '../../threads/contract/service/rollouts.js';
import { ThreadHarness, ThreadLive } from '../../threads/contract/service/engine.js';

const connectedModel = Effect.fnUntraced(function* (
  registry: ProviderRegistry['Service'],
  accounts: ProviderAccounts['Service'],
  harnesses: HarnessRegistry['Service'],
): Effect.fn.Return<Connection, HarnessFailure> {
  const discovery = yield* Effect.serviceOption(DefaultLogins);
  if (Option.isSome(discovery)) yield* discovery.value.ready;
  const catalog = yield* registry.catalog;
  const hosting: string[] = [];
  for (const provider of catalog.models.providers) {
    if (catalog.failures.has(provider.id) || provider.textless === true) continue;
    const hosts = yield* harnesses.seating({ provider: provider.id, model: null, reasoning: null, switches: {} }, catalog.models).pipe(
      Effect.as(true),
      Effect.catchTag('GateRefusal', (refusal) => (refusal.code === 'model-unavailable' ? Effect.succeed(false) : Effect.fail(refusal))),
    );
    if (!hosts) continue;
    hosting.push(provider.id);
    if (!catalog.selectable(provider.id)) continue;
    const held = yield* accounts.of(provider.id).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    if (held.some((row) => row.problem === null)) return { model: defaultModelOf(provider), plans: [] };
  }
  if (hosting.length === 0)
    return yield* new GateRefusal('no-provider', 'No installed adapter serves a model a Tagma agent runs on.', [
      'install a provider adapter',
    ]);
  return { model: null, plans: hosting.filter((id) => catalog.models.named(id).auth !== 'api-key') };
});

type Connection = { readonly model: DefaultModel | null; readonly plans: readonly string[] };

const unconnected = () =>
  new GateRefusal('no-model-connected', 'No provider a Tagma agent runs on holds a sign-in or a key.', [
    'sign in to a provider in Providers, or to the CLI of one whose agent Tagma hosts',
    'add an API key in Providers',
  ]);

type Served = { readonly selection: Omit<ModelPreference, 'account'>; readonly option: ModelOption };

const servedSelection = (models: ModelCatalog, memory: ModelMemory): Served | null => {
  const selection = memory.selection;
  const option = selection === null ? undefined : textModelOf(models, selection.provider, selection.model);
  return selection === null || option === undefined ? null : { selection, option };
};

const declaredSwitches = (
  selected: { switches: readonly ModelSwitch[]; label: string },
  chosen: ModelSwitches | undefined,
): Effect.Effect<ModelSwitches, GateRefusal> => {
  const kept: Record<string, string> = {};
  for (const [id, value] of Object.entries(chosen ?? {})) {
    const declared = selected.switches.find((option) => option.id === id);
    if (!declared)
      return new GateRefusal(
        'model-switch-unsupported',
        `"${id}" is not offered by ${selected.label}.`,
        selected.switches.length === 0
          ? ['choose a model whose catalog row offers it']
          : [`this model offers: ${selected.switches.map((option) => option.id).join(', ')}`],
      );
    if (!declared.values.some((option) => option.id === value))
      return new GateRefusal('model-switch-unsupported', `"${declared.label}" has no value "${value}" for ${selected.label}.`, [
        `choose one of: ${declared.values.map((option) => option.id).join(', ')}`,
      ]);
    kept[id] = value;
  }
  return Effect.succeed(kept);
};

const rememberedSwitches = (option: ModelOption, memory: ModelMemory): ModelSwitches =>
  keptSwitches(option.switches, memory.switches[option.provider]?.[option.id] ?? {});

const servedMemory = (models: ModelCatalog, memory: ModelMemory): RememberedSwitches => {
  const served: Record<string, Record<string, ModelSwitches>> = {};
  for (const [provider, kept] of Object.entries(memory.switches))
    for (const model of Object.keys(kept)) {
      const option = textModelOf(models, provider, model);
      if (option !== undefined) served[provider] = { ...served[provider], [model]: rememberedSwitches(option, memory) };
    }
  return served;
};

const STEP_WINDOW_MS = 3 * 60_000;

const carryFailed =
  (threadId: string) =>
  (failure: HarnessFailure | ThreadModelRefused | ThreadRunsFailure): HarnessFailure => {
    if (failure instanceof ThreadModelRefused)
      return new GateRefusal('thread-running', `The turn of ${threadId} did not reach the end of its step, so its model stayed.`, [
        'choose the model again',
        'stop the turn, then choose the model',
      ]);
    if (failure instanceof ThreadMissing)
      return new GateRefusal('thread-gone', `Thread ${threadId} is gone.`, ['name a thread that stands']);
    if (
      failure instanceof ThreadRunConflict ||
      failure instanceof ThreadRunRefused ||
      failure instanceof ThreadDeliveryConflict ||
      failure instanceof ThreadRunUnavailable ||
      failure instanceof ThreadRunLost
    )
      return new ThreadCallBroke({ cause: failure });
    return failure;
  };

export const publishDefaultMoves = Effect.gen(function* () {
  const live = yield* ThreadLive;
  const threads = yield* ThreadLookup;
  const harness = yield* ThreadHarness;
  const list = yield* ThreadList;
  yield* Stream.runForEach((yield* DefaultAccounts).defaultAccountMoved, (provider) =>
    Effect.forEach(
      live.watched(),
      (threadId) =>
        threads.summary(threadId).pipe(
          Effect.flatMap((row) =>
            row !== undefined && row.provider === provider && row.account === null ? harness.threads.publish(threadId) : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : Effect.logWarning('a default account moved, but a thread state was not published', { threadId, cause }),
          ),
        ),
      { discard: true },
    ).pipe(Effect.andThen(Effect.sync(() => list.resync()))),
  );
});

export const credentialsFailed = <A, E>(
  work: Effect.Effect<A, E | TokenStoreFault>,
): Effect.Effect<A, Exclude<E, TokenStoreFault> | ThreadCallBroke> =>
  Effect.mapError(work, (cause) =>
    cause instanceof TokenStoreFailed || cause instanceof CredentialFileFailed || cause instanceof CredentialFileInvalid
      ? new ThreadCallBroke({ cause })
      : (cause as Exclude<E, TokenStoreFault>),
  );

const accountKeysOf =
  (accounts: ProviderAccounts['Service']) =>
  (provider: string): Effect.Effect<readonly string[], HarnessFailure> =>
    storedKeys(accounts, provider).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));

export const makeBirthModels = Effect.fnUntraced(function* ({ rows }: { readonly rows: ModelPreferenceRows }) {
  const registry = yield* ProviderRegistry;
  const accounts = yield* ProviderAccounts;
  const harnesses = yield* HarnessRegistry;
  const accountDefaults = yield* Effect.serviceOption(DefaultAccounts);
  const accountKeys = accountKeysOf(accounts);
  const birthAccount = (provider: string, draft: string | undefined): Effect.Effect<string | null, HarnessFailure> =>
    draft === undefined
      ? Effect.succeed(null)
      : accountKeys(provider).pipe(
          Effect.flatMap((keys) => (keys.includes(draft) ? Effect.succeed(draft) : unknownAccount(provider, draft, keys))),
        );
  return BirthModelSelection.of({
    remember: Effect.fn('BirthModelSelection.remember')(function* (selection) {
      const { models } = yield* registry.catalog;
      if (selection.model === null) return;
      const option = textModelOf(models, selection.provider, selection.model);
      if (option === undefined) return;
      yield* rows.rememberModelSelection(OPERATOR_PRINCIPAL, { ...selection, model: option.id });
    }),
    selection: Effect.fnUntraced(function* (input) {
      const memory = yield* rows.memory(OPERATOR_PRINCIPAL);
      const { models } = yield* registry.catalog;
      const saved = servedSelection(models, memory)?.selection ?? null;
      const connected = saved === null ? (yield* connectedModel(registry, accounts, harnesses)).model : null;
      const defaults = saved ?? (connected === null ? null : { ...connected, switches: {} });
      const provider = input.profile?.model?.provider ?? defaults?.provider;
      if (provider === undefined) return yield* unconnected();
      if (!models.registered(provider)) {
        const refused = notInstalled(provider);
        return yield* new GateRefusal(refused.code, refused.reason, [
          ...refused.unblock,
          'leave model out of the agent definition to use the operator defaults',
        ]);
      }
      const judgment = yield* profileModel(models, defaults, input.profile ?? null).pipe(
        Effect.mapError((failure) => {
          const refused = planeRefusalOf(failure);
          return refused?.code === 'model-unserved'
            ? new GateRefusal(refused.code, refused.reason, [
                'name a served provider and model in the agent definition',
                'leave model out of the agent definition to use the operator defaults',
              ])
            : failure;
        }),
      );
      const served = defaults === null || judgment !== null ? null : yield* servedTextModel(models, defaults.provider, defaults.model);
      const picked =
        judgment !== null
          ? { option: judgment.option, reasoning: judgment.reasoning }
          : served !== null
            ? { option: served, reasoning: callRung(served, defaults?.reasoning) }
            : null;
      if (picked === null) return yield* unconnected();
      const selected = picked.option;
      const account = yield* birthAccount(selected.provider, input.account);
      const fallback = Option.isSome(accountDefaults) ? (yield* accountDefaults.value.defaultAccount(selected.provider)).account : null;
      const held = yield* accounts
        .of(registry.current().accountSource(selected.provider))
        .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      const effective = held.find((row) => row.key === (account ?? fallback));
      if (effective?.problem?.kind === 'signed-out')
        return yield* new GateRefusal('account-signed-out', `${selected.provider} account ${effective.key} is signed out.`, [
          'sign in again to this account',
          'choose another account',
        ]);
      const chosen = yield* declaredSwitches(selected, input.switches);
      return {
        provider: selected.provider,
        model: selected.id,
        reasoning: picked.reasoning,
        account,
        switches: { ...rememberedSwitches(selected, memory), ...chosen },
      };
    }),
    switches: Effect.fnUntraced(function* (input) {
      if (input.switches === undefined && input.model === null) return {};
      const { models } = yield* registry.catalog;
      const memory = yield* rows.memory(OPERATOR_PRINCIPAL);
      const selected = yield* servedTextModel(models, input.provider, input.model);
      const chosen = yield* declaredSwitches(selected, input.switches);
      return { ...rememberedSwitches(selected, memory), ...chosen };
    }),
  });
});

export const makeModelPreferences = Effect.fnUntraced(function* ({ rows }: { readonly rows: ModelPreferenceRows }) {
  const harness = yield* ThreadHarness;
  const threads = yield* ThreadLookup;
  const records = yield* ThreadRecords;
  const defaultAccounts = yield* DefaultAccounts;
  const rollouts = yield* ThreadRollouts;
  const units = yield* MachineUnits;
  const moves = yield* HarnessMoves;
  const registry = yield* ProviderRegistry;
  const accounts = yield* ProviderAccounts;
  const harnesses = yield* HarnessRegistry;
  const accountKeys = accountKeysOf(accounts);
  const served = (provider: string, model: string | null | undefined) =>
    Effect.flatMap(registry.catalog, ({ models }) => servedTextModel(models, provider, model));

  const validateAccount = (provider: string, account: string | null | undefined): Effect.Effect<void, HarnessFailure> => {
    if (account === null || account === undefined) return Effect.void;
    return accountKeys(provider).pipe(
      Effect.flatMap((keys) => (keys.includes(account) ? Effect.void : unknownAccount(provider, account, keys))),
    );
  };

  const accountForWrite = Effect.fnUntraced(function* (threadId: string, settings: ThreadModelSettings) {
    if (settings.account !== undefined) {
      yield* validateAccount(settings.provider, settings.account);
      return settings.account;
    }
    const thread = yield* threads.find(threadId, OPERATOR_PRINCIPAL);
    const held = thread?.account ?? null;
    if (held === null) return null;
    const keys = yield* accountKeys(settings.provider);
    return keys.includes(held) ? held : null;
  });

  return ModelPreferences.of({
    modelDefaults: Effect.fnUntraced(function* (): Effect.fn.Return<ModelDefaults, HarnessFailure> {
      const { models } = yield* registry.catalog;
      const standing = yield* units.read((unit) =>
        Effect.gen(function* () {
          const memory = yield* rows.memory(OPERATOR_PRINCIPAL, unit);
          const selected = servedSelection(models, memory);
          const account = selected === null ? null : (yield* defaultAccounts.defaultAccount(selected.selection.provider, unit)).account;
          return { memory, selected, account };
        }),
      );
      const remembered = servedMemory(models, standing.memory);
      if (standing.selected !== null)
        return {
          status: 'read',
          defaults: {
            ...standing.selected.selection,
            account: standing.account,
            switches: rememberedSwitches(standing.selected.option, standing.memory),
          },
          remembered,
        };
      const { model: fallback, plans } = yield* connectedModel(registry, accounts, harnesses);
      if (fallback === null) return { status: 'unconnected', plans };
      const option = textModelOf(models, fallback.provider, fallback.model);
      return {
        status: 'read',
        defaults: { ...fallback, account: null, switches: option === undefined ? {} : rememberedSwitches(option, standing.memory) },
        remembered,
      };
    }),

    setModelDefaults: (selection) =>
      served(selection.provider, selection.model).pipe(
        Effect.flatMap((selected) => declaredSwitches(selected, selection.switches)),
        Effect.flatMap((chosen) =>
          Effect.flatMap(selection.account === null ? Effect.succeed([]) : accountKeys(selection.provider), (stored) =>
            units.write(writes('ModelPreferences.setModelDefaults', [defaultAccount, modelPreference]), (unit) =>
              Effect.gen(function* () {
                const { account: named, ...kept } = selection;
                const account =
                  named === null
                    ? yield* defaultAccounts.defaultAccount(selection.provider, unit)
                    : yield* defaultAccounts.settleDefaultAccount(unit, selection.provider, named, stored);
                const saved = yield* rows.saveModelSelection(
                  OPERATOR_PRINCIPAL,
                  {
                    ...kept,
                    switches: selection.switches === undefined ? kept.switches : chosen,
                  },
                  unit,
                );
                return { ...saved, account: account.account };
              }),
            ),
          ),
        ),
      ),

    favoriteModels: () =>
      Effect.map(Effect.all([rows.favoriteModels(OPERATOR_PRINCIPAL), registry.catalog]), ([favorites, { models }]) => ({
        models: favorites.models.filter((pair) => textModelOf(models, pair.provider, pair.model) !== undefined),
      })),

    setFavoriteModels: (favorites) =>
      Effect.andThen(
        Effect.forEach(favorites.models, (pair) => served(pair.provider, pair.model), { discard: true }),
        rows.saveFavoriteModels(OPERATOR_PRINCIPAL, favorites),
      ),

    setModelSettings: (threadId, projectId, settings) =>
      Effect.all({
        switches: Effect.flatMap(served(settings.provider, settings.model), (selected) => declaredSwitches(selected, settings.switches)),
        account: accountForWrite(threadId, settings),
      }).pipe(
        Effect.flatMap(({ switches, account }) =>
          gated(records, threadId, projectId, () =>
            Effect.gen(function* () {
              const handle = harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
              const now = yield* Clock.currentTimeMillis;
              const { moved } = yield* handle
                .carryModel({
                  threadId,
                  request: { key: crypto.randomUUID(), deadline: new Date(now + STEP_WINDOW_MS) },
                  move: (resume) =>
                    Effect.map(
                      moves.move(threadId, {
                        provider: settings.provider,
                        model: settings.model,
                        reasoning: settings.reasoning,
                        account,
                        switches,
                      }),
                      (landed) => (landed === null ? null : { ...landed, resume }),
                    ),
                  running: (failure) => failure instanceof GateRefusal && failure.code === 'thread-running',
                  restoreOnFailure: true,
                })
                .pipe(Effect.mapError(carryFailed(threadId)));
              if (moved !== null) return yield* harness.reads.snapshot(threadId);
              return yield* handle
                .setModelSettings({ ...settings, account, switches })
                .pipe(Effect.tap(() => rollouts.appendMeta(threadId)));
            }),
          ),
        ),
      ),
  });
});
