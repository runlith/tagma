import type { TranscriptEvent } from '@tagma/server/threads/contract/wire/transcript';
import { TRANSCRIPT_CHANGED } from '@tagma/server/views/contract/wire/bridge';
import { untrack } from 'svelte';
import type { ViewCall } from '../views/ViewBridge.js';
import type { TranscriptPort, TranscriptSeat } from './ThreadTranscripts.js';
import { TranscriptFollow } from './transcript.js';

type Following = {
  readonly opened: (call: ViewCall) => Promise<TranscriptEvent>;
  readonly older: () => Promise<object>;
  readonly stop: (reason: string) => void;
};

const following = new WeakMap<AbortSignal, Map<string, Following>>();

const begin = (seat: TranscriptSeat, threadId: string, call: ViewCall): Following => {
  const follow = new TranscriptFollow(threadId, seat.fold);
  let live = false;
  let ready = false;
  let paging: Promise<unknown> = Promise.resolve();
  let opening: () => void = () => undefined;
  let refused: (failure: Error) => void = () => undefined;
  const opened = new Promise<void>((resolve, reject) => {
    opening = resolve;
    refused = reject;
  });
  opened.catch(() => undefined);
  const send = () => {
    for (const event of follow.step()) call.notify(TRANSCRIPT_CHANGED, event);
  };
  const stopEffect = $effect.root(() => {
    $effect(() => {
      const status = seat.status;
      void seat.fold.revision;
      if (!ready) {
        if (status === 'failed') refused(new Error(seat.problem ?? 'the thread could not be read'));
        else if (status === 'ready') {
          ready = true;
          opening();
        }
        return;
      }
      if (live) untrack(send);
    });
  });
  const torn = () => stop('the view was torn down');
  const stop = (reason: string) => {
    call.mounted.removeEventListener('abort', torn);
    live = false;
    stopEffect();
    seat.release();
    refused(new Error(reason));
  };
  call.mounted.addEventListener('abort', torn, { once: true });
  return {
    opened: async (asking) => {
      await new Promise<void>((resolve, reject) => {
        const gone = () => reject(new Error('the request was cancelled'));
        if (asking.signal.aborted) return gone();
        asking.signal.addEventListener('abort', gone, { once: true });
        opened.then(resolve, reject);
      });
      live = false;
      const initial = follow.start();
      //! The answer is posted a tick after this returns; changes wait until then so none reaches the view before it.
      setTimeout(() => {
        live = ready;
        if (live) send();
      }, 0);
      return initial;
    },
    older: () => {
      const page = paging.then(async () => {
        let scan = follow.older();
        while (scan.hungry && (await seat.older())) scan = follow.older();
        return follow.taken(scan);
      });
      paging = page.catch(() => undefined);
      return page;
    },
    stop,
  };
};

export const transcriptMethods = (port: TranscriptPort, projectId: number) => ({
  transcript: async (threadId: string, call: ViewCall): Promise<TranscriptEvent> => {
    if (call.mounted.aborted) throw new Error('the view was torn down');
    const held = following.get(call.mounted) ?? new Map<string, Following>();
    following.set(call.mounted, held);
    let open = held.get(threadId);
    if (open === undefined) {
      open = begin(port.take(projectId, threadId), threadId, call);
      held.set(threadId, open);
    }
    try {
      return await open.opened(call);
    } catch (failure) {
      if (held.get(threadId) === open) {
        held.delete(threadId);
        open.stop('the transcript could not be opened');
      }
      throw failure;
    }
  },
  older: async (threadId: string, call: ViewCall): Promise<object> => {
    const open = following.get(call.mounted)?.get(threadId);
    if (open === undefined) throw new Error('the thread is not watched: call tagma/transcript first');
    return open.older();
  },
  unwatch: (threadId: string, call: ViewCall): object => {
    const held = following.get(call.mounted);
    const open = held?.get(threadId);
    if (open === undefined) return { watched: false };
    held?.delete(threadId);
    open.stop('the view stopped watching the thread');
    return { watched: true };
  },
});
