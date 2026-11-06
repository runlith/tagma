import type { DesktopKeys as Bridge, GlobalAnswer, KeyPress, WindowKeys } from '@tagma/desktop/bridge';
import { chordId, held, type HostChord, hostChordOf, type Press, pressed } from '@tagma/server/platform/contract/wire/chord';
import { Host } from '@runlith/layer/Host';
import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { spellChord } from '$lib/shared/chordSpelling.js';
import { DesktopKeys } from '$lib/shared/desktop/DesktopKeys.js';
import { ActionRunner, type Origin, type Runner } from './ports.js';
import type { Binding, KeyTable, Place } from './resolve.js';

type Handler = (origin: Origin) => boolean;

type Hold = { press(send: boolean): void; lift(send: boolean): void };

type Capture = (chord: HostChord | null) => void;

type Held = { readonly run: Handler; readonly framed: string | undefined };

const HERE: Origin = { page: null, frame: null };

const EMPTY: KeyTable = { bindings: [], displaced: [] };

const NO_RUNNER: Runner = { owns: () => false, run: () => false };

const pressOf = (event: KeyboardEvent): Press => ({
  key: event.key,
  code: event.code,
  meta: event.metaKey,
  ctrl: event.ctrlKey,
  alt: event.altKey,
  shift: event.shiftKey,
});

export class Keymap extends Service<Keymap>()('Keymap', { tier: 'app' }) {
  static *make() {
    const keymap = new Keymap(yield* Host, (yield* ActionRunner.optional()) ?? NO_RUNNER, yield* DesktopKeys.optional());
    (yield* Scope).defer(keymap.listen());
    return keymap;
  }

  table = $state.raw<KeyTable>(EMPTY);
  answers = $state.raw<ReadonlyMap<string, GlobalAnswer>>(new Map());

  private places = new Map<Place, ReadonlyMap<string, Binding>>();
  private globals: ReadonlyMap<string, Binding> = new Map();
  private holdsByChord: ReadonlyMap<string, Binding> = new Map();
  private readonly handlers = new Map<string, readonly Held[]>();
  private readonly holds = new Map<string, readonly Hold[]>();
  private served: readonly string[] = [];
  private holding: { readonly hold: Hold; readonly key: string } | null = null;
  private capturing: Capture | null = null;
  private published = '';

  constructor(
    private readonly host: Host,
    private readonly runner: Runner,
    private readonly desktop: Bridge | undefined,
  ) {
    super();
  }

  get mac(): boolean {
    return this.host.apple;
  }

  set(table: KeyTable): void {
    this.table = table;
    const places = new Map<Place, Map<string, Binding>>();
    const globals = new Map<string, Binding>();
    const holds = new Map<string, Binding>();
    for (const binding of table.bindings) {
      const id = chordId(binding.chord);
      if (binding.hold) holds.set(chordId({ ...binding.chord, shift: false }), binding);
      if (binding.global) globals.set(id, binding);
      const place = places.get(binding.place) ?? new Map<string, Binding>();
      place.set(id, binding);
      places.set(binding.place, place);
    }
    this.places = places;
    this.globals = globals;
    this.holdsByChord = holds;
    this.publish();
  }

  serve(origins: readonly string[]): () => void {
    this.served = origins;
    this.publish();
    return () => {
      if (this.served !== origins) return;
      this.served = [];
      this.publish();
    };
  }

  handle(action: string, run: Handler, framed?: string): () => void {
    const held: Held = { run, framed };
    this.handlers.set(action, [...(this.handlers.get(action) ?? []), held]);
    this.publish();
    return () => {
      this.handlers.set(
        action,
        (this.handlers.get(action) ?? []).filter((one) => one !== held),
      );
      this.publish();
    };
  }

  hold(action: string, hold: Hold): () => void {
    this.holds.set(action, [...(this.holds.get(action) ?? []), hold]);
    return () =>
      this.holds.set(
        action,
        (this.holds.get(action) ?? []).filter((one) => one !== hold),
      );
  }

  capture(listener: Capture): () => void {
    this.capturing = listener;
    return () => {
      if (this.capturing === listener) this.capturing = null;
    };
  }

  keysOf(action: string): readonly HostChord[] {
    return this.table.bindings.filter((binding) => binding.action === action).map((binding) => binding.chord);
  }

  spell(action: string): string | null {
    const chord = this.keysOf(action)[0];
    return chord === undefined ? null : spellChord(chord, this.mac);
  }

  spellChord(chord: HostChord): string {
    return spellChord(chord, this.mac);
  }

  spellText(text: string): string {
    const chord = hostChordOf(text, this.mac);
    return chord === null ? text : spellChord(chord, this.mac);
  }

  chordOf(event: KeyboardEvent): HostChord | null {
    return pressed(pressOf(event), this.mac);
  }

  matches(event: KeyboardEvent, text: string): boolean {
    const chord = this.chordOf(event);
    const wanted = hostChordOf(text, this.mac);
    return chord !== null && wanted !== null && chordId(chord) === chordId(wanted);
  }

  actionAt(event: KeyboardEvent, place: Place): string | null {
    return this.actionOf(pressOf(event), place);
  }

  actionOf(press: Press, place: Place): string | null {
    const chord = pressed(press, this.mac);
    return chord === null ? null : (this.places.get(place)?.get(chordId(chord))?.action ?? null);
  }

  answerOf(chord: HostChord): GlobalAnswer | null {
    return this.answers.get(chordId(chord)) ?? null;
  }

  run(action: string, origin: Origin = HERE): boolean {
    const foreign = origin.frame !== null && !this.served.some((served) => origin.frame?.startsWith(served) === true);
    for (const held of (this.handlers.get(action) ?? []).toReversed()) {
      if (foreign && (held.framed === undefined || origin.frame?.startsWith(held.framed) !== true)) continue;
      if (held.run(origin)) return true;
    }
    return !foreign && this.runner.run(action, origin);
  }

  private delivered(press: KeyPress): void {
    const capturing = this.capturing;
    if (capturing !== null) {
      const chord = press.global ? null : hostChordOf(press.chord, this.mac);
      if (chord !== null) capturing(chord);
      return;
    }
    const binding = press.global ? this.globals.get(press.chord) : this.places.get('window')?.get(press.chord);
    if (binding !== undefined && !binding.hold) this.run(binding.action, { page: press.page, frame: press.frame });
  }

  private publish(): void {
    if (this.desktop === undefined) return;
    const window = [...(this.places.get('window')?.values() ?? [])].filter(
      (binding) => !binding.hold && (this.runner.owns(binding.action) || (this.handlers.get(binding.action)?.length ?? 0) > 0),
    );
    const keys: WindowKeys = {
      chords: window.map((binding) => chordId(binding.chord)),
      claimed: window.filter((binding) => this.runner.owns(binding.action)).map((binding) => chordId(binding.chord)),
      framed: [...this.handlers].flatMap(([action, held]) =>
        held.flatMap((one) =>
          one.framed === undefined
            ? []
            : window
                .filter((binding) => binding.action === action)
                .map((binding) => ({ chord: chordId(binding.chord), frame: one.framed! })),
        ),
      ),
      served: this.served,
      global: [...this.globals.values()].map((binding) => ({ chord: chordId(binding.chord), action: binding.action, hold: binding.hold })),
    };
    const told = JSON.stringify(keys);
    if (told === this.published) return;
    this.published = told;
    this.desktop.publish(keys);
  }

  private tapped = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || this.capturing !== null) return;
    const chord = this.chordOf(event);
    const binding = chord === null ? undefined : this.places.get('window')?.get(chordId(chord));
    if (binding === undefined || binding.hold) return;
    if (this.run(binding.action)) event.preventDefault();
  };

  private held = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    const capturing = this.capturing;
    if (capturing !== null) {
      const chord = this.chordOf(event);
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (chord === null && !(plain && event.key === 'Escape')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (plain && event.key === 'Escape') capturing(null);
      else if (chord !== null && held(chord)) capturing(chord);
      return;
    }
    if (event.defaultPrevented) return;
    const chord = this.chordOf(event);
    const binding = chord === null ? undefined : this.holdsByChord.get(chordId({ ...chord, shift: false }));
    const hold = binding === undefined ? undefined : this.holds.get(binding.action)?.at(-1);
    if (chord === null || hold === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    this.holding = { hold, key: chord.key };
    hold.press(event.shiftKey);
  };

  private lifted = (event: KeyboardEvent): void => {
    const holding = this.holding;
    if (holding === null || this.chordOf(event)?.key !== holding.key) return;
    event.preventDefault();
    event.stopPropagation();
    this.holding = null;
    holding.hold.lift(event.shiftKey);
  };

  private listen(): () => void {
    window.addEventListener('keydown', this.held, { capture: true });
    window.addEventListener('keyup', this.lifted, { capture: true });
    window.addEventListener('keydown', this.tapped);
    const unheard = this.desktop?.onPress((press) => this.delivered(press));
    const unanswered = this.desktop?.onAnswers((answers) => (this.answers = new Map(answers.map((answer) => [answer.chord, answer]))));
    void this.desktop?.answers().then((answers) => (this.answers = new Map(answers.map((answer) => [answer.chord, answer]))));
    return () => {
      window.removeEventListener('keydown', this.held, { capture: true });
      window.removeEventListener('keyup', this.lifted, { capture: true });
      window.removeEventListener('keydown', this.tapped);
      unheard?.();
      unanswered?.();
    };
  }
}
