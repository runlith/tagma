import { type Strain, strainOf } from '@tagma/server/browser/contract/wire/host';

const CLEAR: Strain = { factor: 1, paused: false };

type HeldStrain = { readonly holds: Map<symbol, Strain>; current: Strain };

export type CpuLease = {
  readonly update: (renderers: Iterable<number>, pending: boolean) => void;
  readonly release: () => void;
};

export class RendererStrain {
  private readonly renderers = new Map<number, HeldStrain>();
  private readonly profiles = new Map<string, HeldStrain>();

  constructor(private readonly onPause?: (renderers: ReadonlySet<number>) => void) {}

  hold(renderers: Iterable<number>, strain: Strain): () => void {
    const captured = new Set(renderers);
    const release = this.holdIn(this.renderers, captured, strain);
    if (strain.paused) this.onPause?.(captured);
    return release;
  }

  cpu(profile: string, factor: number): CpuLease {
    const strain: Strain = { factor, paused: false };
    const held = new Map<number, () => void>();
    let fallback: (() => void) | null = null;
    let active = true;
    return {
      update: (renderers, pending) => {
        if (!active) return;
        const next = new Set(renderers);
        for (const renderer of next) {
          if (!held.has(renderer)) held.set(renderer, this.hold([renderer], strain));
        }
        for (const [renderer, release] of held) {
          if (next.has(renderer)) continue;
          release();
          held.delete(renderer);
        }
        if (pending) fallback ??= this.holdIn(this.profiles, new Set([profile]), strain);
        else {
          fallback?.();
          fallback = null;
        }
      },
      release: () => {
        active = false;
        for (const release of held.values()) release();
        held.clear();
        fallback?.();
        fallback = null;
      },
    };
  }

  current(renderer: number, profile: string): Strain {
    return strainOf([this.renderers.get(renderer)?.current ?? CLEAR, this.profiles.get(profile)?.current ?? CLEAR]);
  }

  private holdIn<Key>(states: Map<Key, HeldStrain>, captured: ReadonlySet<Key>, strain: Strain): () => void {
    const hold = Symbol();
    for (const key of captured) {
      let state = states.get(key);
      if (state === undefined) {
        state = { holds: new Map(), current: CLEAR };
        states.set(key, state);
      }
      state.holds.set(hold, strain);
      state.current = strainOf([state.current, strain]);
    }
    return () => {
      for (const key of captured) {
        const state = states.get(key);
        if (state === undefined || !state.holds.delete(hold)) continue;
        if (state.holds.size === 0) states.delete(key);
        else state.current = strainOf(state.holds.values());
      }
    };
  }
}
