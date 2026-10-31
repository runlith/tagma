import type { SessionRef } from '@tagma/server/platform/contract/wire/session';
import { SETTABLE_SCOPES, type SettableScope, type SettingScope } from '@tagma/server/platform/contract/wire/setting';
import type { SettingEntry as ServedEntry } from '@tagma/server/settings/contract/wire/catalog';
import { Process } from '@runlith/layer/process';
import { Scope } from '@runlith/layer/Scope';
import type { Told } from '$lib/wire/told.js';
import { Refusal, toldOf } from '$lib/wire/refusal.js';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';

export type SettingEntry = ServedEntry & {
  readonly rejection?: { readonly scope: string; readonly reason: string };
};

export type SettingSection = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
};

export type SettingAnswer = {
  readonly own?: unknown;
  readonly declined: boolean;
  readonly writer?: SessionRef;
  readonly inherited: unknown;
  readonly inheritedFrom: SettingScope;
  readonly overriddenBy?: { readonly scope: SettableScope; readonly value: unknown };
};

export type WriteOutcome =
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'refused';
      readonly code: string;
      readonly reason: string;
      readonly unblock: readonly string[];
      readonly told: Told;
    };

const SAVED_SHOWN_MS = 2_000;
const NONE: readonly SettingEntry[] = [];

const STORED_UNAPPLIED = 'setting-unapplied';

type Settings = ReturnType<typeof SettingsRepo.use>;

export type SettingsCatalogOptions = { projectId: number };

export class SettingsCatalog extends Process<SettingsCatalog, SettingsCatalogOptions>()('SettingsCatalog') {
  static override *make(options: SettingsCatalogOptions) {
    return new SettingsCatalog(yield* SettingsRepo, yield* SectionRegistry, yield* Scope, options);
  }

  sections = $state<readonly SettingSection[]>([]);
  private served = $state.raw<readonly SettingEntry[]>([]);
  readonly entries = $derived<readonly SettingEntry[]>(
    this.served.map((entry) => {
      const section = this.registry.sectionOf(entry);
      return section === entry.section ? entry : { ...entry, section };
    }),
  );
  loading = $state(false);
  error = $state<string | null>(null);
  busyKey = $state<string | null>(null);
  outcomes = $state<Record<string, WriteOutcome>>({});

  readonly projectId: number;

  private readonly fading = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly repo: Settings,
    private readonly registry: SectionRegistry,
    private readonly scope: Scope,
    options: SettingsCatalogOptions,
  ) {
    super();
    this.projectId = options.projectId;
    scope.defer(() => {
      for (const timer of this.fading) clearTimeout(timer);
      this.fading.clear();
    });
    void this.load();
  }

  private readonly bySection = $derived.by(() => {
    const index = new Map<string, SettingEntry[]>();
    for (const entry of this.entries) {
      const held = index.get(entry.section);
      if (held === undefined) index.set(entry.section, [entry]);
      else held.push(entry);
    }
    return index;
  });

  entriesOf(sectionId: string): readonly SettingEntry[] {
    return this.bySection.get(sectionId) ?? NONE;
  }

  answerOf(entry: SettingEntry, scope: SettableScope): SettingAnswer {
    return settingAnswer(entry, scope);
  }

  setCount(scope: SettableScope, sectionId: string): number {
    return this.entriesOf(sectionId).filter((entry) => entry.layers[scope] !== undefined).length;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const catalog = await this.repo.catalog.key(this.projectId).refresh({ throwOnError: true });
      if (this.scope.signal.aborted) return;
      if (catalog) this.take(catalog);
    } catch (caught) {
      if (!this.scope.signal.aborted) this.error = messageOf(caught);
    } finally {
      this.loading = false;
    }
  }

  async write(input: { scope: SettableScope; key: string; value?: unknown; declined?: boolean }): Promise<void> {
    this.busyKey = input.key;
    try {
      const written = await this.repo.write.run({ ...input, projectId: this.projectId }, { throwOnError: true });
      if (this.scope.signal.aborted) return;
      if (written) {
        this.take(written.settings);
        this.repo.catalog.key(this.projectId).setCache(written.settings);
      }
      this.record(input.key, { kind: 'saved' });
      const timer = setTimeout(() => {
        this.fading.delete(timer);
        if (this.outcomes[input.key]?.kind === 'saved') this.record(input.key, undefined);
      }, SAVED_SHOWN_MS);
      this.fading.add(timer);
    } catch (caught) {
      if (this.scope.signal.aborted) return;
      const outcome = refusedOutcome(caught);
      this.record(input.key, outcome);
      if (outcome.kind === 'refused' && outcome.code === STORED_UNAPPLIED) await this.load();
    } finally {
      this.busyKey = null;
    }
  }

  private record(key: string, outcome: WriteOutcome | undefined): void {
    const { [key]: gone, ...rest } = this.outcomes;
    this.outcomes = outcome === undefined ? rest : { ...rest, [key]: outcome };
  }

  private take(catalog: {
    sections: readonly { id: string; title: string; description?: string }[];
    entries: readonly Omit<SettingEntry, 'rejection'>[];
    rejections: readonly { key: string; scope: string; reason: string }[];
  }): void {
    const rejections = new Map(catalog.rejections.map((rejection) => [rejection.key, rejection]));
    this.sections = catalog.sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description ?? '',
    }));
    this.served = catalog.entries
      .filter((entry) => entry.control?.kind !== 'machine')
      .map((entry) => {
        const rejection = rejections.get(entry.id);
        return { ...entry, rejection: rejection ? { scope: rejection.scope, reason: rejection.reason } : undefined };
      });
  }
}

export function settingAnswer(entry: ServedEntry, scope: SettableScope): SettingAnswer {
  const at = SETTABLE_SCOPES.indexOf(scope);
  const own = entry.layers[scope];
  let inherited: unknown = entry.fallback;
  let inheritedFrom: SettingScope = 'default';
  for (const under of SETTABLE_SCOPES.slice(0, at)) {
    const said = entry.scopes.includes(under) ? entry.layers[under] : undefined;
    if (said?.value === undefined) continue;
    inherited = said.value;
    inheritedFrom = under;
  }
  let overriddenBy: { scope: SettableScope; value: unknown } | undefined;
  for (const over of SETTABLE_SCOPES.slice(at + 1)) {
    const said = entry.scopes.includes(over) ? entry.layers[over] : undefined;
    if (said?.value === undefined) continue;
    overriddenBy = { scope: over, value: said.value };
  }
  return {
    own: own?.value,
    declined: own?.declined ?? false,
    writer: own?.writer,
    inherited,
    inheritedFrom,
    overriddenBy,
  };
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function refusedOutcome(caught: unknown): WriteOutcome {
  return caught instanceof Refusal
    ? { kind: 'refused', code: caught.code, reason: caught.reason, unblock: caught.unblock, told: caught.told }
    : { kind: 'refused', code: 'failed', reason: messageOf(caught), unblock: [], told: toldOf(caught) };
}
