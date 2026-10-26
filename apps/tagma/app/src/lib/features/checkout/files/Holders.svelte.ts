import type { Hand } from '@tagma/server/change-record/contract/wire/holdings';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { HoldingsReading } from '$lib/features/worktrees/HoldingsReading.svelte.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import type { DocumentPlace } from './documentKey.js';

export type HoldersWatch = { hands(path: string): readonly Hand[]; release(): void };

type Shared = { readonly reading: HoldingsReading; users: number };

export class Holders {
  private readonly open = new Map<string, Shared>();

  constructor(private readonly live: LiveConnection) {}

  watch(place: DocumentPlace & { readonly rootId: RootId }): HoldersWatch {
    const key = `${place.projectId}\u0000${place.rootId}`;
    let shared = this.open.get(key);
    if (shared === undefined) {
      const reading = new HoldingsReading(this.live, place.projectId);
      reading.aim({ root: place.rootId });
      shared = { reading, users: 0 };
      this.open.set(key, shared);
    }
    shared.users += 1;
    const held = shared;
    let released = false;
    return {
      hands: (path) => {
        const verdict = held.reading.of(path)?.verdict;
        return verdict?.verdict === 'proven' ? verdict.hands.filter((hand) => !hand.retired) : [];
      },
      release: () => {
        if (released) return;
        released = true;
        held.users -= 1;
        if (held.users > 0) return;
        held.reading.close();
        if (this.open.get(key) === held) this.open.delete(key);
      },
    };
  }

  close(): void {
    for (const { reading } of this.open.values()) reading.close();
    this.open.clear();
  }
}
