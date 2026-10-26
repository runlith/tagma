import { Service } from '@runlith/layer/key';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { MediaQuery } from 'svelte/reactivity';

export type ThemeChoice = 'system' | 'light' | 'dark';

export type ThemeMode = 'light' | 'dark';

export const THEME_KEY = 'mode-watcher-mode';

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const choiceOf = (value: string | null): ThemeChoice => CHOICES.find((choice) => choice === value) ?? 'system';

export class Theme extends Service<Theme>()('Theme', { tier: 'app' }) {
  static *make() {
    return new Theme((yield* Platform).storage.local, yield* Scope);
  }

  choice = $state<ThemeChoice>('system');
  private readonly light = new MediaQuery('prefers-color-scheme: light');
  private painted = false;

  constructor(
    private readonly storage: PlatformStorage,
    scope: Scope,
  ) {
    super();
    this.choice = choiceOf(storage.getItem(THEME_KEY));
    scope.defer(storage.watch(THEME_KEY, (value) => (this.choice = choiceOf(value))));
  }

  get mode(): ThemeMode {
    if (this.choice !== 'system') return this.choice;
    return this.light.current ? 'light' : 'dark';
  }

  choose(next: ThemeChoice): void {
    this.storage.setItem(THEME_KEY, next);
    this.choice = next;
  }

  paint(): void {
    const mode = this.mode;
    const root = document.documentElement;
    if (!this.painted) {
      this.painted = true;
      apply(root, mode);
      return;
    }
    const still = document.createElement('style');
    still.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.append(still);
    apply(root, mode);
    void getComputedStyle(root).colorScheme;
    requestAnimationFrame(() => still.remove());
  }
}

function apply(root: HTMLElement, mode: ThemeMode): void {
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
}
