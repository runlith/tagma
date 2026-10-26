import { journalAt, type Journal, type JournalAsk, type JournalReady, type JournalReply } from './journal.js';

declare const self: Worker;

let journal: Journal | undefined;

self.onmessage = (event: MessageEvent<JournalAsk>) => {
  const ask = event.data;
  let reply: JournalReply;
  try {
    if (ask.kind === 'open') {
      const opened = journalAt(ask.path, ask.memory);
      journal = opened.journal;
      reply = { kind: 'opened', restored: opened.restored };
    } else {
      if (journal === undefined) throw new Error('the commit journal has not opened');
      if (ask.kind === 'admit') {
        journal.admit(ask.seq, ask.queued);
        reply = { kind: 'stored', warning: null };
      } else reply = { kind: 'stored', warning: journal.settle(ask.seq) };
    }
  } catch (failure) {
    reply = { kind: 'failed', reason: String(failure) };
  }
  self.postMessage(reply);
};
self.postMessage({ kind: 'ready' } satisfies JournalReady);
