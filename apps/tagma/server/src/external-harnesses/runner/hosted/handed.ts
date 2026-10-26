import { EXECUTES } from '../../contract/wire/extensions.js';

export class Handed {
  private readonly calls = new Set<string>();

  add(toolCallId: string): void {
    this.calls.add(toolCallId);
  }

  taken(toolCallId: string): boolean {
    return this.calls.delete(toolCallId);
  }

  offered(hosted: boolean): Readonly<Record<string, boolean>> | undefined {
    return hosted ? { [EXECUTES]: true } : undefined;
  }

  answered(toolCallId: string, hosted: boolean): Readonly<Record<string, boolean>> | undefined {
    const handed = this.taken(toolCallId);
    return handed || hosted ? { [EXECUTES]: handed } : undefined;
  }
}
