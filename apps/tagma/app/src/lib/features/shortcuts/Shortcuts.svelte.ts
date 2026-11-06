import { chordId, fromHost, type HostChord, hostChordOf, writeChord } from '@tagma/server/platform/contract/wire/chord';
import type { WatchedSettings } from '@tagma/server/settings/contract/wire/feeds';
import { ShortcutBindings } from '@tagma/server/settings/contract/wire/shortcuts';
import { Host } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Result, Schema } from 'effect';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { ShellKeys } from '$lib/app/keys/ports.js';
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
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ActionCatalog, keyedOf, type Listed } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';

const BINDINGS = 'shortcuts.bindings';

export type Row = {
  readonly listed: Listed;
  readonly keyed: Keyed;
  readonly bound: readonly Binding[];
  readonly displaced: readonly Displaced[];
  readonly changed: boolean;
};

type Offered = { readonly action: string; readonly title: string; readonly chord: HostChord; readonly allowed: boolean };

const decode = Schema.decodeUnknownResult(ShortcutBindings);

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

export class Shortcuts extends Service<Shortcuts>()('Shortcuts', { tier: 'app', eager: true }) {
  static *make() {
    const shortcuts = new Shortcuts(
      yield* Keymap,
      yield* ActionCatalog,
      yield* ShellKeys,
      yield* Host,
      yield* Door,
      yield* Workspace,
      yield* Notices,
    );
    const held = (yield* Live).hold(
      (client) => client['settings.watch']({ keys: [BINDINGS] }),
      (event) => shortcuts.heard(event),
      (failure) => {
        if (failure.kind === 'subscription') shortcuts.problem = failure.message;
      },
    );
    (yield* Scope).defer(() => held.unsubscribe());
    return shortcuts;
  }

  raw = $state.raw<ShortcutBindings>({});
  problem = $state<string | null>(null);

  readonly keyed = $derived.by(() =>
    keyedOf(
      this.catalog.listed.map((listed) => listed.action),
      this.host,
    ),
  );
  readonly person = $derived.by(() => personOf(this.raw, this.host.apple));
  readonly table = $derived.by(() => resolveKeys(this.keyed, this.person, this.shell.kept));
  readonly rows = $derived.by((): readonly Row[] => {
    const keyed = new Map(this.keyed.map((one) => [one.id, one]));
    return this.catalog.listed.flatMap((listed): readonly Row[] => {
      const one = keyed.get(listed.action.id);
      if (one === undefined) return [];
      return [
        {
          listed,
          keyed: one,
          bound: this.table.bindings.filter((binding) => binding.action === one.id),
          displaced: this.table.displaced.filter((displaced) => displaced.action === one.id),
          changed: this.raw[one.id] !== undefined,
        },
      ];
    });
  });

  constructor(
    private readonly keymap: Keymap,
    private readonly catalog: { readonly listed: readonly Listed[] },
    private readonly shell: { readonly kept: readonly HostChord[] },
    private readonly host: Host,
    private readonly door: Door,
    private readonly workspace: Workspace,
    private readonly notices: Notices,
  ) {
    super();
    $effect(() => this.keymap.set(this.table));
  }

  titleOf(action: string): string {
    return this.catalog.listed.find((listed) => listed.action.id === action)?.action.title ?? action;
  }

  rowOf(action: string): Row | undefined {
    return this.rows.find((row) => row.keyed.id === action);
  }

  holder(action: string, chord: HostChord, global: boolean): Holder | null {
    const keyed = this.keyedOf(action);
    return keyed === undefined ? null : holderOf(this.table, keyed, chord, global, this.shell.kept);
  }

  take(action: string, chord: HostChord, global: boolean, mode: 'replace' | 'add'): Promise<void> {
    const keyed = this.keyedOf(action);
    if (keyed === undefined) return Promise.resolve();
    return this.write(takeChord(this.table, this.keyed, this.person, { keyed, chord, global, mode }));
  }

  everywhere(action: string, chord: HostChord, global: boolean): Promise<void> {
    const keyed = this.keyedOf(action);
    return keyed === undefined ? Promise.resolve() : this.write(globalOf(this.table, keyed, chord, global, this.person));
  }

  reset(action: string): Promise<void> {
    const keyed = this.keyedOf(action);
    return keyed === undefined ? Promise.resolve() : this.write(resetKeys(this.person, keyed));
  }

  remove(action: string): Promise<void> {
    const keyed = this.keyedOf(action);
    return keyed === undefined ? Promise.resolve() : this.write(removeKeys(this.person, keyed));
  }

  displacedOf(plugin: string): readonly Displaced[] {
    const own = new Set(this.pluginKeyed(plugin).map((keyed) => keyed.id));
    return this.table.displaced.filter((displaced) => own.has(displaced.action));
  }

  offeredOf(plugin: string): readonly Offered[] {
    return this.pluginKeyed(plugin).flatMap((keyed) =>
      keyed.defaults
        .filter((proposal) => proposal.global)
        .map((proposal) => ({
          action: keyed.id,
          title: this.titleOf(keyed.id),
          chord: proposal.chord,
          allowed: this.table.bindings.some(
            (binding) => binding.action === keyed.id && binding.global && chordId(binding.chord) === chordId(proposal.chord),
          ),
        })),
    );
  }

  private heard(event: WatchedSettings): void {
    if (!(BINDINGS in event.values)) return;
    const decoded = decode(event.values[BINDINGS]);
    if (Result.isSuccess(decoded)) this.raw = decoded.success;
    this.problem = null;
  }

  private pluginKeyed(plugin: string): readonly Keyed[] {
    const own = new Set(this.catalog.listed.filter((listed) => listed.action.by?.plugin === plugin).map((listed) => listed.action.id));
    return this.keyed.filter((keyed) => own.has(keyed.id));
  }

  private keyedOf(action: string): Keyed | undefined {
    return this.keyed.find((keyed) => keyed.id === action);
  }

  private async write(person: PersonKeys): Promise<void> {
    const before = this.raw;
    const value = rawOf(person, this.host.apple);
    const project = this.workspace.contextProject ?? this.workspace.projects[0];
    if (project === undefined) return;
    this.raw = value;
    try {
      await this.door.perform('write_setting_layer', { scope: 'user', key: BINDINGS, value }, { project: String(project.id) });
    } catch (error) {
      this.raw = before;
      this.notices.refusal(error);
    }
  }
}
