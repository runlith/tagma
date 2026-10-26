import { globalShortcut } from 'electron';

export type ConcealableWindow = {
  isShown(): boolean;
  conceal(): void;
  reveal(): void;
};

export type QuickHideShortcutOptions = {
  readonly accelerator: string;
  readonly windowBehavior: ConcealableWindow;
};

export class QuickHideShortcut {
  private readonly accelerator: string;
  private readonly windowBehavior: ConcealableWindow;
  private registered = false;
  private disposed = false;

  constructor(options: QuickHideShortcutOptions) {
    this.accelerator = options.accelerator;
    this.windowBehavior = options.windowBehavior;
  }

  register(): void {
    if (this.disposed || this.registered) return;

    const registered = globalShortcut.register(this.accelerator, () => {
      this.toggle();
    });
    if (!registered) {
      console.warn(`[quick-hide] The accelerator is unavailable: ${this.accelerator}`);
      return;
    }

    this.registered = true;
  }

  dispose(): void {
    if (this.registered) {
      globalShortcut.unregister(this.accelerator);
      this.registered = false;
    }
    this.disposed = true;
  }

  private toggle(): void {
    if (this.disposed) return;

    if (this.windowBehavior.isShown()) {
      this.windowBehavior.conceal();
      return;
    }

    this.windowBehavior.reveal();
  }
}
