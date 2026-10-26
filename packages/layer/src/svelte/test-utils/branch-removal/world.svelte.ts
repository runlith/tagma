export type Slot = { readonly active: string };

export class BranchWorld {
  slot = $state<Slot | null>({ active: 'one' });
  other = $state(0);
  tick = $state(0);
  readonly failures: unknown[] = [];
  private gate: Promise<void> = Promise.resolve();

  hold(): () => void {
    let release = (): void => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  reach(slot: Slot | null): Promise<void> {
    void slot;
    return this.gate;
  }
}
