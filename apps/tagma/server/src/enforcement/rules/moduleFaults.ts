import { GateRefusal } from '../../platform/contract/wire/refusal.js';

type Fault = {
  readonly module: string;
  readonly field: string;
  readonly value: unknown;
  readonly said: string;
  readonly fix: string;
};

export class ModuleFaults {
  private readonly found: Fault[] = [];

  add(module: string, field: string, value: unknown, said: string, fix: string): void {
    this.found.push({ module, field, value, said, fix });
  }

  get any(): boolean {
    return this.found.length > 0;
  }

  refusal(): GateRefusal<'module-shape'> {
    const place = (one: Fault) => `\`${one.module}\` ${one.field}${one.value === undefined ? '' : ` = ${JSON.stringify(one.value)}`}`;
    const lines = this.found.map((one) => `- ${place(one)}: ${one.said}`);
    const fixes = [...new Set(this.found.map((one) => `${place(one)}: ${one.fix}`))];
    return new GateRefusal('module-shape', [`${this.found.length} fault(s) in the request; nothing was written:`, ...lines].join('\n'), [
      fixes[0] ?? 'send the request again',
      ...fixes.slice(1),
    ]);
  }
}
