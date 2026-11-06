import type { GlobalShortcuts, Shortcut } from '@runlith/desktop-host/GlobalShortcuts';
import { type HostChord, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import type { GlobalAnswer, GlobalKey, KeyPress } from './bridge.js';
import type { HoldGrant } from './Dictation.js';

const HIDE_ACTION = 'tagma.hide';

export interface HoldPort {
  arm(chord: HostChord | null): Promise<void>;
  grant(): HoldGrant;
  watch(listener: () => void): () => void;
}

export interface PressTarget {
  deliver(press: KeyPress): void;
  toggleHidden(): void;
}

type Standing = { readonly chord: string; readonly answer: GlobalAnswer | null };

export class Globals {
  private signature = '[]';
  private standing: readonly Standing[] = [];
  private told = '[]';
  private target: PressTarget | null = null;
  private readonly listeners = new Set<(answers: readonly GlobalAnswer[]) => void>();

  constructor(
    private readonly registrar: GlobalShortcuts,
    private readonly holds: HoldPort,
    private readonly mac: boolean,
  ) {
    holds.watch(() => this.tell());
  }

  attach(target: PressTarget): void {
    this.target = target;
  }

  set(keys: readonly GlobalKey[]): void {
    const signature = JSON.stringify(keys);
    if (signature === this.signature) return;
    this.signature = signature;
    const taps = new Map<string, Shortcut>();
    const standing: Standing[] = [];
    let held: HostChord | null = null;
    const refuse = (chord: string, reason: string): void => void standing.push({ chord, answer: { chord, grant: 'unavailable', reason } });
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key.chord)) continue;
      seen.add(key.chord);
      const chord = hostChordOf(key.chord, this.mac);
      if (chord === null) refuse(key.chord, `${key.chord} is no chord.`);
      else if (!key.hold) taps.set(key.chord, { chord, press: () => this.press(key) });
      else if (held === null) {
        held = chord;
        standing.push({ chord: key.chord, answer: null });
      } else refuse(key.chord, 'Only one key can be held in every app.');
    }
    for (const [chord, registration] of this.registrar.set(taps)) {
      const answer: GlobalAnswer =
        registration.kind === 'held'
          ? { chord, grant: 'held', reason: null }
          : registration.kind === 'taken'
            ? { chord, grant: 'taken', reason: null }
            : { chord, grant: 'unavailable', reason: registration.reason };
      standing.push({ chord, answer });
    }
    this.standing = standing;
    void this.holds.arm(held);
    this.tell();
  }

  answers(): readonly GlobalAnswer[] {
    return this.standing.map((one) => one.answer ?? { chord: one.chord, ...this.holds.grant() });
  }

  onAnswers(listener: (answers: readonly GlobalAnswer[]) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  dispose(): void {
    this.registrar.dispose();
  }

  private press(key: GlobalKey): void {
    if (key.action === HIDE_ACTION) this.target?.toggleHidden();
    else this.target?.deliver({ chord: key.chord, page: null, frame: null, global: true });
  }

  private tell(): void {
    const answers = this.answers();
    const told = JSON.stringify(answers);
    if (told === this.told) return;
    this.told = told;
    for (const listener of this.listeners) listener(answers);
  }
}
