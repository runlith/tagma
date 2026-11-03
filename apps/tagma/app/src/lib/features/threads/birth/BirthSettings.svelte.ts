import { Effect } from 'effect';
import type { ModelDefaultsWrite } from '@tagma/server/native-harness/contract/wire/modelSelection';
import type { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import type { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import type { AgentTypes } from '../AgentTypes.svelte.js';
import type { DraftChoices, ThreadDraft } from '../Draft.svelte.js';
import type { Favorites } from '../Favorites.svelte.js';
import type { ModelDefaults } from '../ModelDefaults.svelte.js';
import type { ModelSwitches } from '@runlith/llm/models/description';
import {
  accountMissingOf,
  type AccountMove,
  birthable,
  carriedSwitches,
  chosenSwitches,
  type ModelSettings,
  type ModelView,
  modelListOf,
  modelSettingsOf,
  pickableProviders,
  pickedModel,
  type PickOptions,
  standingSwitches,
  type ThreadModelList,
} from '../thread/modelSettings.js';
import type { ThreadRefused } from '../thread/ThreadRefused.js';

type SignedOut = { readonly provider: string; readonly account: string; readonly label: string };

export class BirthSettings implements ModelView {
  private writing = $state(false);

  constructor(
    private readonly draft: ThreadDraft,
    private readonly defaults: ModelDefaults,
    private readonly types: AgentTypes,
    private readonly accounts: UsageAccounts,
    private readonly favorites: Favorites,
    private readonly catalog: ProviderCatalog,
  ) {}

  get busy(): boolean {
    return this.writing;
  }

  get pending(): boolean {
    return !this.defaults.known;
  }

  connecting = $state(false);

  connectAnotherWay(): void {
    this.connecting = true;
    this.defaults.readConnection();
  }

  private pickable = $derived.by(() => pickableProviders(this.catalog.models, undefined, this.types.served, null));

  settings = $derived.by<ModelSettings | null>(() => {
    const selection = this.defaults.value;
    if (selection === null) return null;
    return modelSettingsOf({
      models: this.catalog.models,
      selection,
      switches: { ...(selection.switches ?? {}), ...this.draft.switches },
      pinned: this.draft.account,
      pickable: this.pickable,
      accounts: this.accounts,
      favorites: this.favorites.list,
      busy: this.writing,
    });
  });

  modelList = $derived.by<ThreadModelList | null>(() =>
    this.settings === null ? null : modelListOf(this.catalog.models, this.settings, this.pickable, this.defaults.remembered),
  );

  accountMissing = $derived.by<boolean>(() => {
    const selection = this.defaults.value;
    return selection === null ? false : accountMissingOf(this.catalog.models, selection.provider, this.draft.account, this.accounts);
  });

  signedOut = $derived.by<SignedOut | null>(() => {
    const settings = this.settings;
    if (settings === null || settings.account === '') return null;
    const row = this.accounts.signing(settings.provider).find((one) => String(one.account) === settings.account);
    return row?.problem?.kind === 'signed-out' ? { provider: row.provider, account: String(row.account), label: row.label } : null;
  });

  readonly accountLabel: string | null = null;

  readonly chosenLabel: string | null = null;

  readonly accountMove: AccountMove | null = null;

  chooseModel(provider: string, modelId: string, reasoning?: string | null, options?: PickOptions): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const settings = this.settings;
      const pick = pickedModel(this.catalog.models, settings, this.pickable, provider, modelId, reasoning);
      if (settings === null || pick === null) return Effect.void;
      const kept = provider === settings.provider && pick.model.id === settings.model ? this.draft.switches : {};
      const switches = { ...kept, ...options?.switches };
      const account = options?.account !== undefined ? options.account : provider === settings.provider ? this.draft.account : null;
      const flipped = Object.keys(options?.switches ?? {}).length > 0;
      const remembered = carriedSwitches(pick.model, switches, standingSwitches(this.defaults.remembered, provider, pick.model.id));
      return this.remember(
        provider,
        pick.model.id,
        pick.rung,
        (draft) => {
          draft.setSwitches(switches);
          draft.setAccount(account);
        },
        flipped ? remembered : undefined,
      );
    });
  }

  chooseAccount(value: string | null): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const settings = this.settings;
      if (!settings || !this.catalog.subscribed(settings.provider)) return Effect.void;
      return this.remember(settings.provider, settings.model, settings.reasoning || null, (draft) => draft.setAccount(value || null));
    });
  }

  chooseSwitch(id: string, value: string | null): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const settings = this.settings;
      if (!settings) return Effect.void;
      const chosen = chosenSwitches(settings, { id, value });
      this.draft.setSwitches(chosen);
      if (!birthable(this.catalog.models, settings.provider, this.types.served)) return Effect.void;
      return this.save({
        account: null,
        provider: settings.provider,
        model: settings.model,
        reasoning: settings.reasoning || null,
        switches: chosen,
      });
    });
  }

  private remember(
    provider: string,
    model: string,
    reasoning: string | null,
    apply: (draft: DraftChoices) => void,
    switches?: ModelSwitches,
  ): Effect.Effect<void, ThreadRefused> {
    const draft = this.draft.pin();
    if (!birthable(this.catalog.models, provider, this.types.served)) return Effect.sync(() => apply(draft));
    return this.save({ account: null, provider, model, reasoning, switches }).pipe(Effect.andThen(Effect.sync(() => apply(draft))));
  }

  private save(write: ModelDefaultsWrite): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      this.writing = true;
      return Effect.asVoid(this.defaults.save(write)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            this.writing = false;
          }),
        ),
      );
    });
  }
}
