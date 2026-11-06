import { globalShortcut } from 'electron';

export type Shortcut = {
  readonly accelerator: string;
  readonly press: () => void;
};

type Registration = { readonly kind: 'held' } | { readonly kind: 'taken' } | { readonly kind: 'refused'; readonly reason: string };

const HELD: Registration = { kind: 'held' };

const TAKEN: Registration = { kind: 'taken' };

export class GlobalShortcuts {
  private readonly held = new Map<string, string>();
  private readonly presses = new Map<string, () => void>();

  set(wanted: ReadonlyMap<string, Shortcut>): ReadonlyMap<string, Registration> {
    for (const [id, accelerator] of this.held) {
      if (wanted.get(id)?.accelerator === accelerator) continue;
      globalShortcut.unregister(accelerator);
      this.held.delete(id);
      this.presses.delete(id);
    }
    const answers = new Map<string, Registration>();
    for (const [id, shortcut] of wanted) {
      this.presses.set(id, shortcut.press);
      answers.set(id, this.held.has(id) ? HELD : this.register(id, shortcut.accelerator));
    }
    return answers;
  }

  dispose(): void {
    for (const accelerator of this.held.values()) globalShortcut.unregister(accelerator);
    this.held.clear();
    this.presses.clear();
  }

  private register(id: string, accelerator: string): Registration {
    try {
      if (!globalShortcut.register(accelerator, () => this.presses.get(id)?.())) return TAKEN;
    } catch (error) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
    this.held.set(id, accelerator);
    return HELD;
  }
}
