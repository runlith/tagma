import { Layer } from 'effect';
import { subscribersOf } from '../platform/subscribers.js';
import { type CommitLanded, CommitLandings } from './contract/service/commitLandings.js';

export const makeCommitLandings = () =>
  CommitLandings.of(subscribersOf<CommitLanded>('a commit landing subscriber failed', ({ threadId, commit }) => ({ threadId, commit })));

export const commitLandingsLayer = Layer.sync(CommitLandings, makeCommitLandings);
