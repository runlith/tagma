import { chordId, type HostChord } from '@tagma/server/platform/contract/wire/chord';

export type Place = 'window' | 'terminal';

type Proposal = { readonly chord: HostChord; readonly global: boolean };

export type Keyed = {
  readonly id: string;
  readonly place: Place;
  readonly hold: boolean;
  readonly rank: number | null;
  readonly defaults: readonly Proposal[];
};

export type PersonKeys = Readonly<Record<string, readonly Proposal[]>>;

export type Binding = {
  readonly action: string;
  readonly chord: HostChord;
  readonly place: Place;
  readonly global: boolean;
  readonly hold: boolean;
  readonly mine: boolean;
  readonly offered: boolean;
};

export type Holder = { readonly kind: 'shell' } | { readonly kind: 'action'; readonly action: string };

export type Displaced = { readonly action: string; readonly chord: HostChord; readonly global: boolean; readonly by: Holder };

export type KeyTable = { readonly bindings: readonly Binding[]; readonly displaced: readonly Displaced[] };

const SHELL: Holder = { kind: 'shell' };

class Holding {
  private readonly everywhere = new Map<string, Holder>();
  private readonly anywhere = new Map<string, Holder>();
  private readonly local = new Map<string, Holder>();

  constructor(kept: readonly HostChord[]) {
    for (const chord of kept) this.everywhere.set(chordId(chord), SHELL);
  }

  holder(chord: HostChord, place: Place, global: boolean): Holder | null {
    const id = chordId(chord);
    return this.everywhere.get(id) ?? (global ? this.anywhere.get(id) : this.local.get(`${place} ${id}`)) ?? null;
  }

  take(action: string, chord: HostChord, place: Place, global: boolean): void {
    const id = chordId(chord);
    const holder: Holder = { kind: 'action', action };
    if (global) this.everywhere.set(id, holder);
    else this.local.set(`${place} ${id}`, holder);
    if (!this.anywhere.has(id)) this.anywhere.set(id, holder);
  }
}

export function resolveKeys(actions: readonly Keyed[], person: PersonKeys, kept: readonly HostChord[]): KeyTable {
  const holding = new Holding(kept);
  const bindings: Binding[] = [];
  const displaced: Displaced[] = [];
  const place = (keyed: Keyed, proposal: Proposal, mine: boolean): void => {
    const global = proposal.global && keyed.place === 'window' && (mine || keyed.rank === null);
    const holder = holding.holder(proposal.chord, keyed.place, global);
    if (holder !== null) {
      displaced.push({ action: keyed.id, chord: proposal.chord, global, by: holder });
      return;
    }
    holding.take(keyed.id, proposal.chord, keyed.place, global);
    bindings.push({
      action: keyed.id,
      chord: proposal.chord,
      place: keyed.place,
      global,
      hold: keyed.hold,
      mine,
      offered: !mine && keyed.rank !== null && proposal.global,
    });
  };
  for (const keyed of actions) for (const proposal of person[keyed.id] ?? []) place(keyed, proposal, true);
  for (const keyed of actions)
    if (keyed.rank === null && person[keyed.id] === undefined) for (const proposal of keyed.defaults) place(keyed, proposal, false);
  const plugins = actions
    .filter((keyed) => keyed.rank !== null && person[keyed.id] === undefined)
    .toSorted((one, other) => (one.rank ?? 0) - (other.rank ?? 0));
  for (const keyed of plugins) for (const proposal of keyed.defaults) place(keyed, proposal, false);
  return { bindings, displaced };
}

const conflicting = (binding: Binding, place: Place, global: boolean): boolean => global || binding.global || binding.place === place;

export function holderOf(table: KeyTable, keyed: Keyed, chord: HostChord, global: boolean, kept: readonly HostChord[]): Holder | null {
  const id = chordId(chord);
  if (kept.some((held) => chordId(held) === id)) return SHELL;
  const found = table.bindings.find(
    (binding) =>
      binding.action !== keyed.id && chordId(binding.chord) === id && conflicting(binding, keyed.place, global && keyed.place === 'window'),
  );
  return found === undefined ? null : { kind: 'action', action: found.action };
}

const boundOf = (table: KeyTable, action: string): readonly Proposal[] =>
  table.bindings.filter((binding) => binding.action === action).map((binding) => ({ chord: binding.chord, global: binding.global }));

const sameList = (one: readonly Proposal[], other: readonly Proposal[]): boolean =>
  one.length === other.length &&
  one.every((proposal, at) => chordId(proposal.chord) === chordId(other[at]!.chord) && proposal.global === other[at]!.global);

const settled = (person: PersonKeys, keyed: Keyed, chosen: readonly Proposal[]): PersonKeys => {
  const { [keyed.id]: _, ...rest } = person;
  return sameList(
    chosen,
    keyed.defaults.map((proposal) => ({ chord: proposal.chord, global: keyed.rank === null && proposal.global })),
  )
    ? rest
    : { ...rest, [keyed.id]: chosen };
};

type Take = { readonly keyed: Keyed; readonly chord: HostChord; readonly global: boolean; readonly mode: 'replace' | 'add' };

export function takeChord(table: KeyTable, actions: readonly Keyed[], person: PersonKeys, take: Take): PersonKeys {
  const id = chordId(take.chord);
  const global = take.global && take.keyed.place === 'window';
  let next = person;
  for (const binding of table.bindings) {
    if (binding.action === take.keyed.id || chordId(binding.chord) !== id || !conflicting(binding, take.keyed.place, global)) continue;
    const holder = actions.find((keyed) => keyed.id === binding.action);
    if (holder === undefined) continue;
    next = settled(
      next,
      holder,
      boundOf(table, holder.id).filter((proposal) => chordId(proposal.chord) !== id),
    );
  }
  const kept = take.mode === 'replace' ? [] : boundOf(table, take.keyed.id).filter((proposal) => chordId(proposal.chord) !== id);
  return settled(next, take.keyed, [...kept, { chord: take.chord, global }]);
}

export function globalOf(table: KeyTable, keyed: Keyed, chord: HostChord, global: boolean, person: PersonKeys): PersonKeys {
  const id = chordId(chord);
  const bound = boundOf(table, keyed.id);
  const chosen = bound.some((proposal) => chordId(proposal.chord) === id) ? bound : [...bound, { chord, global: false }];
  return settled(
    person,
    keyed,
    chosen.map((proposal) => (chordId(proposal.chord) === id ? { chord: proposal.chord, global } : proposal)),
  );
}

export function removeKeys(person: PersonKeys, keyed: Keyed): PersonKeys {
  return keyed.defaults.length === 0 ? settled(person, keyed, []) : { ...person, [keyed.id]: [] };
}

export function resetKeys(person: PersonKeys, keyed: Keyed): PersonKeys {
  const { [keyed.id]: _, ...rest } = person;
  return rest;
}
