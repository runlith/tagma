import type { Chord, DesktopBrowser as Bridge, FramedChord } from '@tagma/desktop/bridge';
import { Host } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { keyOfCode, spellChord } from '$lib/shared/chordSpelling.js';
import { DesktopBrowser } from '$lib/shared/desktop/DesktopBrowser.js';

export type KeyRun = (page: string | null, frame: string | null) => boolean;

export type KeyBinding = { readonly chord: Chord; readonly run: KeyRun; readonly framed?: string };

export type Modifiers = { readonly shift?: boolean; readonly alt?: boolean };

export const sameChord = (one: Chord, other: Chord): boolean =>
  one.code === other.code && one.meta === other.meta && one.ctrl === other.ctrl && one.alt === other.alt && one.shift === other.shift;

export const chordOf = (event: KeyboardEvent): Chord => ({
  code: event.code,
  meta: event.metaKey,
  ctrl: event.ctrlKey,
  alt: event.altKey,
  shift: event.shiftKey,
});

export class Keymap extends Service<Keymap>()('Keymap', { tier: 'app' }) {
  static *make() {
    const keymap = new Keymap(yield* Host, yield* DesktopBrowser.optional());
    (yield* Scope).defer(keymap.listen());
    return keymap;
  }

  private bound: readonly KeyBinding[] = [];

  constructor(
    private readonly host: Host,
    private readonly desktop: Bridge | undefined,
  ) {
    super();
  }

  mod(code: string, modifiers: Modifiers = {}): Chord {
    const mac = this.host.apple;
    return { code, meta: mac, ctrl: !mac, alt: modifiers.alt ?? false, shift: modifiers.shift ?? false };
  }

  spell(chord: Chord): string {
    return spellChord({ ...chord, key: keyOfCode(chord.code) }, this.host.apple);
  }

  bare(code: string): Chord {
    return { code, meta: false, ctrl: false, alt: false, shift: false };
  }

  bind(bindings: readonly KeyBinding[]): () => void {
    this.bound = [...this.bound, ...bindings];
    this.publish();
    return () => {
      this.bound = this.bound.filter((held) => !bindings.includes(held));
      this.publish();
    };
  }

  press(chord: Chord, page: string | null, frame: string | null = null): boolean {
    for (const binding of this.bound.toReversed()) {
      if (!sameChord(binding.chord, chord)) continue;
      if (frame !== null && (binding.framed === undefined || !frame.startsWith(binding.framed))) continue;
      if (binding.run(page, frame)) return true;
    }
    return false;
  }

  private publish(): void {
    const chords: Chord[] = [];
    const framed: FramedChord[] = [];
    for (const binding of this.bound) {
      if (!chords.some((held) => sameChord(held, binding.chord))) chords.push(binding.chord);
      const frame = binding.framed;
      if (frame !== undefined && !framed.some((held) => held.frame === frame && sameChord(held.chord, binding.chord)))
        framed.push({ chord: binding.chord, frame });
    }
    this.desktop?.keys(chords, framed);
  }

  private listen(): () => void {
    const pressed = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!this.press(chordOf(event), null)) return;
      event.preventDefault();
    };
    window.addEventListener('keydown', pressed);
    const unheard = this.desktop?.onKey(({ page, chord, frame }) => void this.press(chord, page, frame));
    return () => {
      window.removeEventListener('keydown', pressed);
      unheard?.();
    };
  }
}
