import { SvelteMap } from 'svelte/reactivity';

type Claim<T> = { readonly value: T };

//! Svelte hands an effect teardown the state from before this flush's writes, so claims live in plain fields and the state only mirrors the winner.
export class Claims<T> {
  private held: readonly Claim<T>[] = [];
  private winner = $state.raw<T | null>(null);

  get current(): T | null {
    return this.winner;
  }

  take(value: T): () => void {
    const claim = { value };
    this.held = [...this.held, claim];
    this.winner = value;
    return () => {
      this.held = this.held.filter((standing) => standing !== claim);
      this.winner = this.held.at(-1)?.value ?? null;
    };
  }
}

export class KeyedClaims<K, T> {
  private readonly held = new Map<K, readonly Claim<T>[]>();
  private readonly winners = new SvelteMap<K, T>();

  has(key: K): boolean {
    return this.winners.has(key);
  }

  get(key: K): T | undefined {
    return this.winners.get(key);
  }

  entries(): IterableIterator<[K, T]> {
    return this.winners.entries();
  }

  take(key: K, value: T): () => void {
    const claim = { value };
    this.held.set(key, [...(this.held.get(key) ?? []), claim]);
    this.winners.set(key, value);
    return () => {
      const rest = (this.held.get(key) ?? []).filter((standing) => standing !== claim);
      const last = rest.at(-1);
      if (last === undefined) {
        this.held.delete(key);
        this.winners.delete(key);
        return;
      }
      this.held.set(key, rest);
      this.winners.set(key, last.value);
    };
  }
}
