import type { Effect } from 'effect';
import type { ThreadRefused } from './ThreadRefused.js';
import { modelContextWindow, type ModelSwitches } from '@runlith/llm/models/description';
import { type ModelOption, reasoningForModel } from '@runlith/llm/models/catalog';
import type { ThreadListRow } from '@tagma/server/threads/contract/wire/list';
import type { RememberedSwitches } from '@tagma/server/native-harness/contract/wire/modelSelection';
import type { FavoritePair } from '$lib/shared/models/favorites.js';
import { choiceKey, type ModelChoice, type ModelLead, togglesOf, windowWord } from '$lib/shared/models/choice.js';
import { signerOf, type UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { signsIn, type ServedModels } from '$lib/features/providers/served.js';

export type ModelSelection = {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type ModelSettings = {
  readonly provider: string;
  readonly model: string;
  readonly modelLabel: string;
  readonly modelShort: string;
  readonly reasoning: string;
  readonly reasoningLabel: string;
  readonly reasoningShort: string;
  readonly contextWindow: number | undefined;
  readonly account: string;
  readonly accountPinned: boolean;
  readonly accountsKnown: boolean;
  readonly accountOptions: readonly { readonly id: string; readonly label: string }[];
  readonly accountMissing: boolean;
  readonly switches: readonly (ModelOption['switches'][number] & { readonly value: string | null })[];
  readonly groups: readonly {
    readonly provider: string;
    readonly label: string;
    readonly models: readonly {
      readonly id: string;
      readonly label: string;
      readonly short: string;
      readonly contextWindow: number | undefined;
    }[];
  }[];
  readonly favorites: readonly {
    readonly provider: string;
    readonly providerLabel: string;
    readonly id: string;
    readonly label: string;
    readonly short: string;
    readonly contextWindow: number | undefined;
  }[];
  readonly reasoningOptions: readonly { readonly id: string; readonly label: string; readonly short: string }[];
  readonly busy: boolean;
};

export type ThreadModelList = {
  readonly choices: readonly ModelChoice[];
  readonly lead: readonly ModelLead[];
  readonly current: string;
  readonly starred: readonly string[];
};

export type SettingsBasis = {
  readonly models: ServedModels;
  readonly selection: ModelSelection;
  readonly switches: ModelSwitches;
  readonly pinned: string | null;
  readonly pickable: readonly string[];
  readonly accounts: UsageAccounts;
  readonly favorites: readonly FavoritePair[];
  readonly busy: boolean;
};

export const birthable = (models: ServedModels, provider: string, served: ReadonlySet<string>): boolean =>
  models.registered(provider) || served.has(provider);

export function pickableProviders(
  models: ServedModels,
  current: string | undefined,
  served: ReadonlySet<string>,
  harness: ThreadListRow | null,
): string[] {
  return models.providerOptions
    .map((option) => option.id)
    .filter(
      (id) =>
        id === current ||
        ((!models.registered(id) || models.named(id).selectable !== false) &&
          birthable(models, id, served) &&
          (harness === null || (harness.harness !== null && harness.harness.capabilities.modelMove !== 'pinned'))),
    );
}

export function accountMissingOf(models: ServedModels, provider: string, pinned: string | null, accounts: UsageAccounts): boolean {
  if (!accounts.known || pinned === null) return false;
  return !signsIn(models, provider) || !accounts.signing(provider).some((row) => row.account === pinned);
}

export function modelSettingsOf(basis: SettingsBasis): ModelSettings {
  const { selection, accounts, models: catalog } = basis;
  const modelsFor = (provider: string) => catalog.modelsFor(provider, 'text');
  const models = modelsFor(selection.provider);
  const current = models.find((option) => option.id === selection.model) ?? (selection.model === '' ? (models[0] ?? null) : null);
  const rows = signsIn(catalog, selection.provider) ? accounts.signing(selection.provider) : [];
  const account = basis.pinned ?? signerOf(rows)?.account ?? null;
  const reasoning = selection.reasoning ?? '';
  const option = current?.reasoningOptions.find((one) => one.id === reasoning);
  return {
    provider: selection.provider,
    model: current?.id ?? '',
    modelLabel: current?.label ?? selection.model,
    modelShort: current?.short ?? selection.model,
    reasoning,
    reasoningLabel: option?.label ?? '',
    reasoningShort: option?.short ?? '',
    contextWindow: modelContextWindow(current?.capacity),
    account: account ?? '',
    accountPinned: basis.pinned !== null,
    accountsKnown: accounts.known,
    accountOptions: rows.map((row) => ({ id: String(row.account), label: row.label })),
    accountMissing: accountMissingOf(catalog, selection.provider, basis.pinned, accounts),
    switches: (current?.switches ?? []).map((one) => ({ ...one, value: basis.switches[one.id] ?? one.default })),
    groups: basis.pickable.map((provider) => ({
      provider,
      label: catalog.providerLabel(provider),
      models: modelsFor(provider).map((one) => ({
        id: one.id,
        label: one.label,
        short: one.short,
        contextWindow: modelContextWindow(one.capacity),
      })),
    })),
    favorites: basis.favorites.flatMap((pair) => {
      const found = modelsFor(pair.provider).find((row) => row.id === pair.model);
      return found && basis.pickable.some((id) => id === pair.provider)
        ? [
            {
              provider: pair.provider,
              providerLabel: catalog.providerLabel(pair.provider),
              id: found.id,
              label: found.label,
              short: found.short,
              contextWindow: modelContextWindow(found.capacity),
            },
          ]
        : [];
    }),
    reasoningOptions: (current?.reasoningOptions ?? []).map((one) => ({ id: one.id, label: one.label, short: one.short })),
    busy: basis.busy,
  };
}

export function modelListOf(
  models: ServedModels,
  settings: ModelSettings,
  pickable: readonly string[],
  remembered: RememberedSwitches,
): ThreadModelList {
  const asked = settings.reasoning || null;
  const current = choiceKey(settings.provider, settings.model);
  const chosen: ModelSwitches = Object.fromEntries(
    settings.switches.flatMap((option) => (option.value === null ? [] : [[option.id, option.value] as const])),
  );
  const choices = pickable.flatMap((provider) => {
    const providerLabel = models.providerLabel(provider);
    return models.modelsFor(provider, 'text').map((option): ModelChoice => {
      const own = provider === settings.provider && option.id === settings.model;
      return {
        provider,
        providerLabel,
        model: option.id,
        label: option.label,
        short: option.short,
        ladder: option.reasoningOptions.map((step) => ({ id: step.id, label: step.label, short: step.short })),
        rung: own ? asked : reasoningForModel(asked, option) || null,
        meta: windowWord(modelContextWindow(option.capacity)),
        toggles: togglesOf(option.switches, own ? chosen : standingSwitches(remembered, provider, option.id)),
      };
    });
  });
  const starred = settings.favorites.map((row) => choiceKey(row.provider, row.id));
  return {
    choices,
    current,
    starred,
    lead: [{ id: 'favorites', label: 'Favorites', starred: true, keys: starred }],
  };
}

export function accountLabelOf(settings: ModelSettings): string | null {
  if (settings.account === '' || !settings.accountsKnown) return null;
  return settings.accountOptions.find((option) => option.id === settings.account)?.label ?? settings.account;
}

export type ModelPick = { readonly model: ModelOption; readonly rung: string | null };

export function pickedModel(
  models: ServedModels,
  settings: ModelSettings | null,
  pickable: readonly string[],
  provider: string,
  modelId: string,
  reasoning: string | null | undefined,
): ModelPick | null {
  const model = models.modelsFor(provider, 'text').find((option) => option.id === modelId);
  if (settings === null || !pickable.some((id) => id === provider) || model === undefined) return null;
  const asked = reasoning === undefined ? settings.reasoning || null : reasoning;
  return { model, rung: reasoningForModel(asked, model) || null };
}

export function chosenSwitches(settings: ModelSettings, change: { readonly id: string; readonly value: string | null }): ModelSwitches {
  const chosen = settings.switches.flatMap((option) => (option.value === null ? [] : [[option.id, option.value] as const]));
  return Object.fromEntries([
    ...chosen.filter(([id]) => id !== change.id),
    ...(change.value === null ? [] : [[change.id, change.value] as const]),
  ]);
}

export const standingSwitches = (remembered: RememberedSwitches, provider: string, model: string): ModelSwitches =>
  remembered[provider]?.[model] ?? {};

export function carriedSwitches(model: ModelOption, current: ModelSwitches, remembered: ModelSwitches): ModelSwitches {
  return Object.fromEntries(
    model.switches.flatMap((option) => {
      const kept = [current[option.id], remembered[option.id]].find(
        (value) => value !== undefined && option.values.some((one) => one.id === value),
      );
      return kept === undefined ? [] : [[option.id, kept]];
    }),
  );
}

export type ContextLabels = { provider: string; model: string };

export function contextLabelsOf(
  models: ServedModels,
  source: { readonly provider: string | null; readonly model: string | null },
  settings: ModelSettings | null,
): ContextLabels | null {
  const provider = source.provider ?? settings?.provider;
  if (!provider) return null;
  const modelId = source.model ?? settings?.model ?? '';
  const model = models.modelsFor(provider, 'text').find((option) => option.id === modelId);
  return {
    provider: models.providerLabel(provider),
    model: model?.label ?? modelId,
  };
}

export type PickOptions = {
  readonly switches?: ModelSwitches;
  readonly account?: string | null;
};

export interface ModelView {
  readonly settings: ModelSettings | null;
  readonly modelList: ThreadModelList | null;
  readonly accountLabel: string | null;
  readonly accountMissing: boolean;
  readonly busy: boolean;
  chooseModel(provider: string, modelId: string, reasoning?: string | null, options?: PickOptions): Effect.Effect<void, ThreadRefused>;
  chooseAccount(value: string | null): Effect.Effect<void, ThreadRefused>;
  chooseSwitch(id: string, value: string | null): Effect.Effect<void, ThreadRefused>;
}
