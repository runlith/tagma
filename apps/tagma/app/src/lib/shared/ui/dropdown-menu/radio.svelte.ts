import { getContext, setContext } from 'svelte';

const CONTEXT = Symbol('dropdown-menu-radio');

export class RadioChoice {
  constructor(
    private readonly current: () => string | undefined,
    private readonly change: (value: string) => void,
  ) {}

  static make(current: () => string | undefined, change: (value: string) => void): RadioChoice {
    const choice = new RadioChoice(current, change);
    setContext(CONTEXT, choice);
    return choice;
  }

  static use(): RadioChoice {
    const choice = getContext<RadioChoice | undefined>(CONTEXT);
    if (choice === undefined) throw new Error('A radio item stands outside a radio group');
    return choice;
  }

  get value(): string | undefined {
    return this.current();
  }

  choose(value: string): void {
    if (value !== this.current()) this.change(value);
  }
}
