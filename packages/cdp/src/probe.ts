export type RendererCpu = { readonly process: string; readonly millis: number };

export class Probe {
  private previous: RendererCpu | null = null;
  private spent = 0;
  private attributed = false;

  constructor(private readonly threshold: number) {}

  start(cpu: RendererCpu): void {
    this.previous = cpu;
    this.spent = 0;
    this.attributed = true;
  }

  suspend(): void {
    this.attributed = false;
  }

  sample(cpu: RendererCpu | null, paused: boolean): boolean {
    const previous = this.previous;
    this.previous = cpu;
    if (!this.attributed) return false;
    if (cpu === null || previous === null || cpu.process !== previous.process || cpu.millis < previous.millis) {
      this.attributed = false;
      this.spent = 0;
      return false;
    }
    if (!paused) this.spent += cpu.millis - previous.millis;
    return this.spent >= this.threshold;
  }
}
