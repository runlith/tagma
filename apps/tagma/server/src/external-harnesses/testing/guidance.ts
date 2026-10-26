import { Effect } from 'effect';
import { makeGuidanceSources } from '../guidanceSources.js';
import { makeSessionPlace } from '../sessions/place.js';
import type { HarnessSessionStore } from '../store/sessions.js';

export const guidanceSourcesOver = (store: HarnessSessionStore) =>
  Effect.flatMap(makeSessionPlace(), (place) => makeGuidanceSources(store, place));
