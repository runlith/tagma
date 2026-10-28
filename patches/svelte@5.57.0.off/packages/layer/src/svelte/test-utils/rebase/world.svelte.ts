export class RebaseWorld {
  a = $state(0);
  b = $state(0);
  c = $state(0);
  private gate: Promise<void> = Promise.resolve();

  hold(): () => void {
    let release = (): void => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async slow(value: number): Promise<number> {
    await this.gate;
    return value;
  }
}
