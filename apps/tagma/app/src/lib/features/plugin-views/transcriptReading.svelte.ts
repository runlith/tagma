import type { TranscriptEntry, TranscriptEvent } from '@tagma/server/threads/contract/wire/transcript';
import { untrack } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import type { TranscriptPort } from './ThreadTranscripts.js';
import { TranscriptFollow } from './transcript.js';

export type Transcript = {
  readonly entries: readonly TranscriptEntry[];
  readonly tail: readonly TranscriptEntry[];
  readonly more: boolean;
  readonly loaded: boolean;
  readonly failure: string | null;
  older(): Promise<void>;
};

const placed = (entries: readonly TranscriptEntry[], entry: TranscriptEntry): readonly TranscriptEntry[] =>
  entries.some((standing) => standing.id === entry.id)
    ? entries.map((standing) => (standing.id === entry.id ? entry : standing))
    : [...entries, entry];

export function transcriptReading(port: TranscriptPort, projectId: number, threadId: string): Transcript {
  let entries = $state.raw<readonly TranscriptEntry[]>([]);
  let tail = $state.raw<readonly TranscriptEntry[]>([]);
  let more = $state(false);
  let loaded = $state(false);
  let failure = $state<string | null>(null);
  let paging: (() => Promise<void>) | null = null;

  const apply = (event: TranscriptEvent): void => {
    switch (event.type) {
      case 'initial':
        entries = event.entries;
        tail = event.tail;
        more = event.more;
        loaded = true;
        failure = null;
        return;
      case 'entry':
        entries = placed(entries, event.entry);
        tail = tail.filter((flying) => flying.id !== event.entry.id);
        return;
      case 'removed':
        entries = entries.filter((entry) => !event.ids.includes(entry.id));
        return;
      case 'tail': {
        const grown = event.tail;
        tail = grown.restart
          ? grown.entries
          : tail.map((flying) => (flying.id === grown.id ? { ...flying, text: `${flying.text ?? ''}${grown.text}` } : flying));
        return;
      }
      case 'failed':
        failure = event.reason;
    }
  };

  const subscribe = createSubscriber(() => {
    const seat = port.take(projectId, threadId);
    const follow = new TranscriptFollow(threadId, seat.fold);
    let started = false;
    let held = true;
    let queue: Promise<unknown> = Promise.resolve();
    const release = () => {
      if (!held) return;
      held = false;
      paging = null;
      seat.release();
    };
    paging = () => {
      const page = queue.then(async () => {
        let scan = follow.older();
        while (scan.hungry && (await seat.older())) scan = follow.older();
        const taken = follow.taken(scan);
        entries = [...taken.entries, ...entries];
        more = taken.more;
      });
      queue = page.catch(() => undefined);
      return page;
    };
    const stop = $effect.root(() => {
      $effect(() => {
        const status = seat.status;
        void seat.fold.revision;
        untrack(() => {
          if (!held) return;
          if (status === 'failed') {
            apply({ type: 'failed', threadId, reason: seat.problem ?? 'the thread could not be read' });
            release();
          } else if (status !== 'ready') return;
          else if (!started) {
            started = true;
            apply(follow.start());
          } else for (const event of follow.step()) apply(event);
        });
      });
    });
    return () => {
      stop();
      release();
      loaded = false;
    };
  });

  return {
    get entries() {
      subscribe();
      return entries;
    },
    get tail() {
      subscribe();
      return tail;
    },
    get more() {
      subscribe();
      return more;
    },
    get loaded() {
      subscribe();
      return loaded;
    },
    get failure() {
      subscribe();
      return failure;
    },
    older: () => (paging === null ? Promise.reject(new Error('the transcript is not read: read its entries first')) : paging()),
  };
}
