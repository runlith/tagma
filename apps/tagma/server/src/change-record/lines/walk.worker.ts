/// <reference types="bun" />

import { authored } from '../threadFiles/authored.js';
import { endsOf } from './ends.js';
import { tallyOf } from './tally.js';
import { bytesDigest } from '@runlith/files/content';
import { hunked } from './hunked.js';
import { answerFold } from './jobs.js';
import { prepareBytes, prepareText } from './folding.js';
import { releaseSpan } from './released.js';
import { debtWindows } from './owed.js';
import { packVerdict } from './packed.js';
import type { WalkAnswer, WalkAsk } from './walks.js';

declare const self: Worker;

const answered = (ask: WalkAsk): WalkAnswer | Promise<WalkAnswer> => {
  switch (ask.kind) {
    case 'fold': {
      let used = 0;
      const answer = answerFold(ask.job, { expired: (amount) => (used += amount) > ask.limit });
      return { id: ask.id, kind: 'fold', answer: { answer, used } };
    }
    case 'pack':
      return { id: ask.id, kind: 'pack', answer: packVerdict(ask.verdict, ask.limit) };
    case 'text':
      return { id: ask.id, kind: 'text', answer: prepareText(ask.text, ask.digest) };
    case 'bytes':
      return { id: ask.id, kind: 'bytes', answer: prepareBytes(ask.bytes) };
    case 'authored': {
      const { base, bytes } = endsOf({ base: ask.authoring.base, bytes: ask.authoring.bytes, normalized: ask.authoring.normalized });
      return { id: ask.id, kind: 'authored', answer: authored({ ...ask.authoring, base, bytes }) };
    }
    case 'hunks':
      return { id: ask.id, kind: 'hunks', answer: ask.pairs.map(hunked) };
    case 'digests':
      return { id: ask.id, kind: 'digests', answer: ask.contents.map(bytesDigest) };
    case 'tallies':
      return { id: ask.id, kind: 'tallies', answer: ask.rows.map(tallyOf) };
    case 'spans':
      return { id: ask.id, kind: 'spans', answer: ask.hunks.map(releaseSpan) };
    case 'windows':
      return { id: ask.id, kind: 'windows', answer: debtWindows(ask.before, ask.after) };
    case 'dependencyImports':
      return import('../prepared/dependencyWalk.js').then(async ({ dependencyImportsOf }) => ({
        id: ask.id,
        kind: 'dependencyImports',
        answer: await dependencyImportsOf(ask.input),
      }));
    case 'placements':
      return import('../prepared/dependencyWalk.js').then(async ({ placementsOf }) => ({
        id: ask.id,
        kind: 'placements',
        answer: await placementsOf(ask.input),
      }));
    case 'dependencies':
      return import('../prepared/dependencyWalk.js').then(async ({ dependenciesOf }) => ({
        id: ask.id,
        kind: 'dependencies',
        answer: await dependenciesOf(ask.input),
      }));
  }
};

self.addEventListener('message', async (event: MessageEvent<WalkAsk>) => {
  try {
    self.postMessage(await answered(event.data));
  } catch (cause) {
    self.postMessage({ id: event.data.id, kind: 'failed', reason: String(cause) } satisfies WalkAnswer);
  }
});
