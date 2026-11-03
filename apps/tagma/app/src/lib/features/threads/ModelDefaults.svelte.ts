import { Effect } from 'effect';
import { untrack } from 'svelte';
import type { ModelDefaultsWrite, RememberedSwitches } from '@tagma/server/native-harness/contract/wire/modelSelection';
import type { ModelPreference } from '@tagma/server/threads/contract/wire/birth';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { ThreadsRepo } from './Repo.js';
import { answered, type ThreadRefused } from './thread/ThreadRefused.js';

export class ModelDefaults extends Service<ModelDefaults>()('ModelDefaults', { tier: 'app' }) {
  static *make() {
    return new ModelDefaults(yield* ThreadsRepo, yield* Notices, yield* ProviderCatalog, yield* UsageAccounts, yield* Scope);
  }

  value = $state<ModelPreference | null>(null);
  remembered = $state.raw<RememberedSwitches>({});
  plans = $state<readonly string[] | null>(null);
  unconnected = $derived(this.plans !== null);
  known = $state(false);
  offered = $state<readonly string[] | null>(null);

  private generation = 0;
  private asked = 0;

  constructor(
    private readonly threads: ThreadsRepo,
    private readonly notices: Notices,
    catalog: ProviderCatalog,
    accounts: UsageAccounts,
    private readonly scope: Scope,
  ) {
    super();
    const stop = $effect.root(() => {
      const held = $derived(
        accounts.rows
          .map(
            (row) =>
              `${row.provider}\n${row.account}\n${row.problem === null}\n${row.lent.map((one) => `${one.provider}:${one.problem === null}`).join(',')}`,
          )
          .join('\n'),
      );
      $effect(() => {
        void catalog.served;
        void held;
        untrack(() => this.reread());
      });
    });
    scope.defer(stop);
  }

  reread(): void {
    if (!this.known) this.readConnection();
    const at = ++this.generation;
    void this.threads.defaults
      .loadOrThrow({ refresh: true })
      .then((answer) => {
        if (this.scope.signal.aborted || answer === undefined || at !== this.generation) return;
        this.value = answer.status === 'read' ? answer.defaults : null;
        this.remembered = answer.status === 'read' ? answer.remembered : {};
        this.plans = answer.status === 'unconnected' ? answer.plans : null;
        this.known = true;
      })
      .catch((error: unknown) => {
        if (!this.scope.signal.aborted) this.notices.background(error);
      });
  }

  readConnection(): void {
    const at = ++this.asked;
    void this.threads.connection
      .loadOrThrow({ refresh: true })
      .then((plans) => {
        if (this.scope.signal.aborted || plans === undefined || at !== this.asked) return;
        this.offered = plans;
      })
      .catch((error: unknown) => {
        if (!this.scope.signal.aborted) this.notices.background(error);
      });
  }

  save(write: ModelDefaultsWrite): Effect.Effect<ModelPreference, ThreadRefused> {
    return answered(() => this.threads.setDefaults.run(write, { throwOnError: true })).pipe(
      Effect.tap((saved) =>
        Effect.sync(() => {
          this.generation++;
          this.value = saved;
          this.remembered = {
            ...this.remembered,
            [saved.provider]: { ...this.remembered[saved.provider], [saved.model]: saved.switches ?? {} },
          };
          this.plans = null;
          this.known = true;
        }),
      ),
    );
  }
}
