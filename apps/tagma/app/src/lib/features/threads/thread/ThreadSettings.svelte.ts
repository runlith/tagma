import { Deferred, Effect, Exit, Queue } from 'effect';
import type { ModelPreference } from '@tagma/server/threads/contract/wire/birth';
import type { ModelDefaultsWrite } from '@tagma/server/native-harness/contract/wire/modelSelection';
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { HARNESS_AGENT_ID } from '@tagma/server/threads/contract/wire/harness/names';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ModelOption } from '@runlith/llm/models/catalog';
import { Service } from '@runlith/layer/key';
import { Favorites } from '../Favorites.svelte.js';
import { AgentTypes } from '../AgentTypes.svelte.js';
import { ModelDefaults } from '../ModelDefaults.svelte.js';
import { ThreadList } from '../List.svelte.js';
import { ThreadsRepo } from '../Repo.js';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';
import { refusedCall, ThreadRefused } from './ThreadRefused.js';
import {
  accountLabelOf,
  accountMissingOf,
  birthable,
  carriedSwitches,
  chosenSwitches,
  modelListOf,
  modelSettingsOf,
  pickableProviders,
  pickedModel,
  standingSwitches,
  type ModelSettings,
  type ModelView,
  type PickOptions,
  type ThreadModelList,
} from './modelSettings.js';

type Intent = {
  readonly selection: ModelPreference;
  readonly carry: { readonly model: ModelOption; readonly current: ModelSwitches } | null;
  readonly defaults: ModelDefaultsWrite | null;
  readonly first: 'defaults' | 'thread';
  readonly done: Deferred.Deferred<void, ThreadRefused>;
  readonly shaped: () => void;
};

export class ThreadSettings extends Service<ThreadSettings>()('ThreadSettings', { tier: 'thread' }) implements ModelView {
  static *make() {
    return new ThreadSettings(
      yield* ThreadFeed,
      yield* ThreadEffects,
      yield* Live,
      (yield* ProjectRung.Current).projectId,
      yield* UsageAccounts,
      yield* Favorites,
      yield* AgentTypes,
      yield* ModelDefaults,
      yield* ThreadList,
      yield* ProviderCatalog,
    );
  }

  private writing = $state(false);
  private intended = $state.raw<ModelPreference | null>(null);
  private draining = false;
  private readonly intents = Effect.runSync(Queue.unbounded<Intent>());
  private readonly waiting = new Set<Deferred.Deferred<void, ThreadRefused>>();
  private readonly shaping = new Set<() => void>();

  constructor(
    private readonly feed: ThreadFeed,
    private readonly effects: ThreadEffects,
    private readonly live: LiveConnection,
    private readonly projectId: number,
    private readonly accounts: UsageAccounts,
    private readonly favorites: Favorites,
    private readonly types: AgentTypes,
    private readonly defaults: ModelDefaults,
    private readonly list: ThreadList,
    private readonly catalog: ProviderCatalog,
  ) {
    super();
  }

  get thread(): WireThread | null {
    return this.feed.session.thread;
  }

  get busy(): boolean {
    return this.writing;
  }

  private harness = $derived.by(() => {
    const row = this.list.row(this.feed.threadId);
    return row?.agentId === HARNESS_AGENT_ID ? row : null;
  });

  pickable = $derived.by(() => pickableProviders(this.catalog.models, this.thread?.provider, this.types.served, this.harness));

  private basis = $derived.by<ModelPreference | null>(() => {
    const thread = this.thread;
    const standing = thread === null ? this.defaults.value : this.fromThread(thread);
    return this.intended ?? standing;
  });

  settings = $derived.by<ModelSettings | null>(() => {
    const selection = this.basis;
    if (selection === null) return null;
    return modelSettingsOf({
      models: this.catalog.models,
      selection,
      switches: selection.switches ?? {},
      pinned: selection.account ?? null,
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
    const basis = this.basis;
    return basis === null ? false : accountMissingOf(this.catalog.models, basis.provider, basis.account, this.accounts);
  });

  accountLabel = $derived.by<string | null>(() => (this.thread === null || this.settings === null ? null : accountLabelOf(this.settings)));

  chooseModel(provider: string, modelId: string, reasoning?: string | null, options?: PickOptions): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const basis = this.basis;
      const pick = pickedModel(this.catalog.models, this.settings, this.pickable, provider, modelId, reasoning);
      if (basis === null || pick === null) return Effect.void;
      const kept = provider === basis.provider && pick.model.id === basis.model ? (basis.switches ?? {}) : {};
      const current = { ...kept, ...options?.switches };
      const switches = carriedSwitches(pick.model, current, standingSwitches(this.defaults.remembered, provider, pick.model.id));
      const selection: ModelPreference = {
        account: options?.account !== undefined ? options.account : provider === basis.provider ? basis.account : null,
        provider,
        model: pick.model.id,
        reasoning: pick.rung,
        switches,
      };
      const flipped = Object.keys(options?.switches ?? {}).length > 0;
      return this.offer(selection, { model: pick.model, current }, this.rememberedAs(selection, flipped), 'defaults');
    });
  }

  chooseAccount(value: string | null): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const basis = this.basis;
      if (basis === null || !this.catalog.subscribed(basis.provider)) return Effect.void;
      const selection: ModelPreference = { ...basis, account: value || null };
      return this.offer(selection, null, this.rememberedAs(selection, false), 'defaults');
    });
  }

  chooseSwitch(id: string, value: string | null): Effect.Effect<void, ThreadRefused> {
    return Effect.suspend(() => {
      const basis = this.basis;
      const settings = this.settings;
      if (basis === null || settings === null) return Effect.void;
      const selection: ModelPreference = { ...basis, switches: chosenSwitches(settings, { id, value }) };
      return this.offer(selection, null, this.rememberedAs(selection, true), 'thread');
    });
  }

  private rememberedAs(selection: ModelPreference, withSwitches: boolean): ModelDefaultsWrite | null {
    if (!birthable(this.catalog.models, selection.provider, this.types.served)) return null;
    return {
      account: null,
      provider: selection.provider,
      model: selection.model,
      reasoning: selection.reasoning,
      switches: withSwitches && selection.switches !== undefined ? selection.switches : undefined,
    };
  }

  private fromThread(thread: WireThread): ModelPreference {
    return {
      account: thread.account,
      provider: thread.provider,
      model: thread.model ?? '',
      reasoning: thread.reasoning,
      switches: thread.switches,
    };
  }

  private offer = Effect.fnUntraced(
    function* (
      this: ThreadSettings,
      selection: ModelPreference,
      carry: Intent['carry'],
      defaults: ModelDefaultsWrite | null,
      first: Intent['first'],
    ): Effect.fn.Return<void, ThreadRefused> {
      const done = yield* Deferred.make<void, ThreadRefused>();
      const shaped = this.feed.shaping.hold(this.feed.threadId);
      this.intended = selection;
      this.waiting.add(done);
      this.shaping.add(shaped);
      this.drained();
      yield* Queue.offer(this.intents, { selection, carry, defaults, first, done, shaped });
      return yield* Deferred.await(done);
    },
    (effect) => this.effects.guard(effect),
  );

  private drained(): void {
    if (this.draining) return;
    this.draining = true;
    void this.effects.run(this.drain());
  }

  private settle(done: Deferred.Deferred<void, ThreadRefused>, exit: Exit.Exit<void, ThreadRefused>): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      this.waiting.delete(done);
      return Deferred.done(done, exit);
    });
  }

  private drain = Effect.fnUntraced(
    function* (this: ThreadSettings): Effect.fn.Return<void> {
      while (true) {
        const batch = yield* Queue.takeAll(this.intents);
        const latest = batch[batch.length - 1];
        for (const dropped of batch.slice(0, -1)) yield* this.settle(dropped.done, Exit.void);
        this.writing = true;
        const exit = yield* Effect.exit(this.write(latest, this.shaped(batch)));
        this.writing = false;
        if (Queue.sizeUnsafe(this.intents) === 0) this.intended = null;
        yield* this.settle(latest.done, exit);
      }
    },
    Effect.ensuring(
      Effect.suspend(() => {
        this.writing = false;
        this.draining = false;
        for (const shaped of this.shaping) shaped();
        this.shaping.clear();
        return Effect.forEach([...this.waiting], (done) => Deferred.interrupt(done), { discard: true });
      }),
    ),
  );

  private remember(defaults: ModelDefaultsWrite | null): Effect.Effect<ModelPreference | null, ThreadRefused> {
    return defaults === null ? Effect.succeed(null) : this.defaults.save(defaults);
  }

  private shaped(batch: readonly Intent[]): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const intent of batch) {
        this.shaping.delete(intent.shaped);
        intent.shaped();
      }
    });
  }

  private write = Effect.fnUntraced(
    function* (this: ThreadSettings, intent: Intent, _answered: Effect.Effect<void>): Effect.fn.Return<void, ThreadRefused> {
      const saved = intent.first === 'defaults' ? yield* this.remember(intent.defaults) : null;
      const params =
        intent.carry === null
          ? intent.selection
          : {
              ...intent.selection,
              switches: carriedSwitches(
                intent.carry.model,
                intent.carry.current,
                saved?.switches ?? standingSwitches(this.defaults.remembered, intent.selection.provider, intent.selection.model),
              ),
            };
      yield* Effect.mapError(
        this.live.attempt((client) => client['thread.model']({ projectId: this.projectId, threadId: this.feed.threadId, params })),
        refusedCall,
      );
      const thread = this.thread;
      if (thread !== null && thread.id === this.feed.threadId) this.feed.session.revise({ ...thread, ...params });
    },
    (effect, intent, answered) =>
      Effect.ensuring(effect, answered).pipe(
        Effect.andThen(Effect.suspend(() => (intent.first === 'thread' ? Effect.asVoid(this.remember(intent.defaults)) : Effect.void))),
      ),
  );
}
