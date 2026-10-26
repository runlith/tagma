import type { ServedCatalog, ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { Live, type LiveConnection } from '$lib/wire/Live.js';
import { providerName, type ServedModels, signsIn } from './served.js';

export class ProviderCatalog extends Service<ProviderCatalog>()('ProviderCatalog', { tier: 'app' }) {
  static *make() {
    return new ProviderCatalog(yield* Live, yield* Scope, yield* Failure);
  }

  served = $state.raw<ServedCatalog>({ providers: [], adapters: [], settings: [], sections: [] });
  received = $state(false);

  constructor(live: LiveConnection, scope: Scope, failure: Failure) {
    super();
    const held = live.hold(
      (client) => client['catalog.subscribe']({}),
      (frame) => {
        this.adopt(frame);
      },
      (reason) => {
        if (reason.kind === 'subscription') failure.report(new Error(reason.message));
      },
    );
    scope.defer(() => held.unsubscribe());
  }

  models = $derived<ServedModels>(modelCatalog(this.served.providers));
  sections = $derived(this.served.sections);

  subscriptions = $derived<readonly string[]>([
    ...this.sections.flatMap((section) =>
      section.options.filter((option) => option.id === section.selected).map((option) => option.provider),
    ),
    ...this.served.providers
      .filter(
        (provider) =>
          signsIn(this.models, provider.id) &&
          !this.sections.some((section) => section.options.some((option) => option.provider === provider.id)),
      )
      .map((provider) => provider.id),
  ]);

  keyed = $derived<readonly string[]>(
    this.served.providers
      .filter((provider) => provider.kind === 'wire' && provider.auth === 'api-key' && provider.instance !== true)
      .map((provider) => provider.id),
  );

  settings = $derived(this.served.settings);

  adopt(served: ServedCatalog): void {
    this.served = served;
    this.received = true;
  }

  installed(id: string): boolean | null {
    return this.received ? this.models.registered(id) : null;
  }

  section(id: string) {
    return this.sections.find((section) => section.options.some((option) => option.provider === id));
  }

  provider(id: string): ServedProvider | undefined {
    return this.served.providers.find((provider) => provider.id === id);
  }

  label(id: string): string {
    return this.models.providerLabel(id);
  }

  name(id: string): string {
    return this.section(id)?.title ?? providerName(this.models, id);
  }

  modeName(id: string): string {
    const section = this.section(id);
    if (section === undefined) return providerName(this.models, id);
    const mode = section.options.find((option) => option.provider === id)?.label;
    return section.options.length < 2 || mode === undefined || mode === section.title ? section.title : `${section.title} ${mode}`;
  }

  subscribed(id: string): boolean {
    return signsIn(this.models, id);
  }
}
