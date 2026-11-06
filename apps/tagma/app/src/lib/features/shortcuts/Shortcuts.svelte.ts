import type { GlobalAnswer } from '@tagma/desktop/bridge';
import { fromHost, type HostChord, hostChordOf, writeChord } from '@tagma/server/platform/contract/wire/chord';
import { type ShortcutBindings, shortcutBindings } from '@tagma/server/settings/contract/wire/shortcuts';
import { Host } from '@runlith/layer/Host';
import { Service } from '@runlith/layer/key';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import {
  type Binding,
  type Displaced,
  globalOf,
  type Holder,
  holderOf,
  type Keyed,
  type PersonKeys,
  removeKeys,
  resetKeys,
  resolveKeys,
  takeChord,
} from '$lib/app/keys/resolve.js';
import { type UserSetting, UserSettings } from '$lib/features/settings/UserSettings.svelte.js';
import { ActionCatalog, type Catalog, keyedOf, type Listed } from '$lib/features/workspace/action.js';
import { type Kept, ShellKeys } from './kept.svelte.js';

export type Row = {
  readonly listed: Listed;
  readonly keyed: Keyed;
  readonly bound: readonly Binding[];
  readonly displaced: readonly Displaced[];
  readonly changed: boolean;
};

type Change = {
  readonly action: string;
  readonly chord: HostChord;
  readonly global: boolean;
  readonly mode: 'replace' | 'add' | 'grant';
};

export type Taken = { readonly change: Change; readonly by: Holder };

type Offered = {
  readonly action: string;
  readonly title: string;
  readonly chord: HostChord;
  readonly allowed: boolean;
  readonly answer: GlobalAnswer | null;
};

const personOf = (raw: ShortcutBindings, mac: boolean): PersonKeys =>
  Object.fromEntries(
    Object.entries(raw).map(([action, chosen]) => [
      action,
      chosen.flatMap((one) => {
        const chord = hostChordOf(one.keys, mac);
        return chord === null ? [] : [{ chord, global: one.global === true }];
      }),
    ]),
  );

const rawOf = (person: PersonKeys, mac: boolean): ShortcutBindings =>
  Object.fromEntries(
    Object.entries(person).map(([action, chosen]) => [
      action,
      chosen.map((one) => ({ keys: writeChord(fromHost(one.chord, mac)), ...(one.global ? { global: true } : {}) })),
    ]),
  );

const byAction = <Item extends { readonly action: string }>(items: readonly Item[]): ReadonlyMap<string, readonly Item[]> => {
  const grouped = new Map<string, Item[]>();
  for (const item of items) grouped.set(item.action, [...(grouped.get(item.action) ?? []), item]);
  return grouped;
};

export class Shortcuts extends Service<Shortcuts>()('Shortcuts', { tier: 'app', eager: true }) {
  static *make() {
    return new Shortcuts(yield* Keymap, yield* ActionCatalog, yield* ShellKeys, yield* Host, (yield* UserSettings).of(shortcutBindings));
  }

  readonly keyed = $derived.by(() =>
    keyedOf(
      this.catalog.listed.map((listed) => listed.action),
      this.host,
    ),
  );
  private readonly keyedById = $derived(new Map(this.keyed.map((one) => [one.id, one])));
  readonly person = $derived.by(() => personOf(this.bindings.value, this.host.apple));
  readonly table = $derived.by(() => resolveKeys(this.keyed, this.person, this.shell.kept));
  readonly rows = $derived.by((): readonly Row[] => {
    const bound = byAction(this.table.bindings);
    const displaced = byAction(this.table.displaced);
    return this.catalog.listed.flatMap((listed): readonly Row[] => {
      const keyed = this.keyedById.get(listed.action.id);
      if (keyed === undefined) return [];
      return [
        {
          listed,
          keyed,
          bound: bound.get(keyed.id) ?? [],
          displaced: displaced.get(keyed.id) ?? [],
          changed: this.bindings.value[keyed.id] !== undefined,
        },
      ];
    });
  });
  private readonly rowsById = $derived(new Map(this.rows.map((row) => [row.keyed.id, row])));
  private readonly settled = $derived.by(
    () => (this.bindings.known || this.bindings.problem !== null) && this.shell.known && this.catalog.settled,
  );

  constructor(
    private readonly keymap: Keymap,
    private readonly catalog: Catalog,
    private readonly shell: Kept,
    private readonly host: Host,
    private readonly bindings: UserSetting<ShortcutBindings>,
  ) {
    super();
    $effect(() => {
      if (this.settled) this.keymap.set(this.table);
    });
  }

  get problem(): string | null {
    return this.bindings.problem;
  }

  titleOf(action: string): string {
    return this.catalog.titleOf(action);
  }

  holderTitle(by: Holder): string {
    return by.kind === 'shell' ? (this.host.isDesktop ? 'Tagma itself' : 'your browser') : this.titleOf(by.action);
  }

  rowOf(action: string): Row | undefined {
    return this.rowsById.get(action);
  }

  ask(change: Change): Taken | null {
    const keyed = this.keyedById.get(change.action);
    if (keyed === undefined) return null;
    const by = holderOf(this.table, keyed, change.chord, change.global, this.shell.kept);
    if (by !== null) return { change, by };
    const { chord, global, mode } = change;
    void this.write(
      mode === 'grant'
        ? globalOf(this.table, keyed, chord, global, this.person)
        : takeChord(this.table, this.keyed, this.person, { keyed, chord, global, mode }),
    );
    return null;
  }

  confirm(taken: Taken): void {
    const keyed = this.keyedById.get(taken.change.action);
    if (keyed === undefined || taken.by.kind === 'shell') return;
    const { chord, global, mode } = taken.change;
    void this.write(takeChord(this.table, this.keyed, this.person, { keyed, chord, global, mode: mode === 'grant' ? 'add' : mode }));
  }

  reset(action: string): Promise<void> {
    const keyed = this.keyedById.get(action);
    return keyed === undefined ? Promise.resolve() : this.write(resetKeys(this.person, keyed));
  }

  remove(action: string): Promise<void> {
    const keyed = this.keyedById.get(action);
    return keyed === undefined ? Promise.resolve() : this.write(removeKeys(this.person, keyed));
  }

  displacedOf(plugin: string): readonly Displaced[] {
    const own = new Set(this.pluginKeyed(plugin).map((keyed) => keyed.id));
    return this.table.displaced.filter((displaced) => own.has(displaced.action));
  }

  offeredOf(plugin: string): readonly Offered[] {
    return this.pluginKeyed(plugin).flatMap((keyed): readonly Offered[] => {
      const title = this.titleOf(keyed.id);
      const bound = this.rowsById.get(keyed.id)?.bound ?? [];
      return [
        ...bound
          .filter((binding) => binding.offered && !binding.global)
          .map((binding) => ({ action: keyed.id, title, chord: binding.chord, allowed: false, answer: null })),
        ...bound
          .filter((binding) => binding.global)
          .map((binding) => ({
            action: keyed.id,
            title,
            chord: binding.chord,
            allowed: true,
            answer: this.keymap.answerOf(binding.chord),
          })),
      ];
    });
  }

  private pluginKeyed(plugin: string): readonly Keyed[] {
    return this.catalog.listed.flatMap((listed) => {
      const keyed = listed.action.by?.plugin === plugin ? this.keyedById.get(listed.action.id) : undefined;
      return keyed === undefined ? [] : [keyed];
    });
  }

  private write(person: PersonKeys): Promise<void> {
    return this.bindings.write(rawOf(person, this.host.apple));
  }
}
