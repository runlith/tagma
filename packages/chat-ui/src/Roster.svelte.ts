import { clashOf } from './RegistryClash';

type Held<T> = { readonly contributor: string; readonly item: T };

export class Roster<T> {
  private ledger: readonly Held<T>[] = [];
  private shown = $state.raw<readonly T[]>([]);

  constructor(
    private readonly subject: (key: string) => string,
    private readonly keyOf: (item: T) => string,
  ) {}

  get items(): readonly T[] {
    return this.shown;
  }

  add(contributor: string, item: T): () => void {
    const key = this.keyOf(item);
    const clash = this.ledger.find((one) => this.keyOf(one.item) === key);
    if (clash !== undefined) throw clashOf(this.subject(key), clash.contributor, contributor);
    const entry: Held<T> = { contributor, item };
    this.settle([...this.ledger, entry]);
    return () => {
      if (this.ledger.includes(entry)) this.settle(this.ledger.filter((one) => one !== entry));
    };
  }

  contributorOf(match: (item: T) => boolean): string | undefined {
    return this.ledger.find((one) => match(one.item))?.contributor;
  }

  private settle(ledger: readonly Held<T>[]): void {
    this.ledger = ledger;
    this.shown = ledger.map((one) => one.item);
  }
}
