import type { FolderFrame } from '@tagma/server/checkout-files/contract/wire/scratch';
import type { LiveConnection } from '$lib/wire/Live.js';

export const SCRATCH_ROWS = 200;

export class ScratchFolder {
  frame = $state.raw<FolderFrame | null>(null);

  refused = $state<string | null>(null);

  private readonly stream: { unsubscribe: () => void };

  constructor(live: LiveConnection, projectId: number, thread: string, path: string) {
    this.stream = live.hold(
      (client) => client['scratch.subscribe']({ projectId, thread, path, limit: SCRATCH_ROWS }),
      (frame) => {
        this.frame = frame;
        this.refused = null;
      },
      (failure) => {
        if (failure.kind === 'subscription') this.refused = failure.message;
      },
    );
  }

  close(): void {
    this.stream.unsubscribe();
  }
}

export const entryPath = (folder: string, name: string): string => (folder === '' ? name : `${folder}/${name}`);
