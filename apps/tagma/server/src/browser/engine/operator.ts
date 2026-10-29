import { Clock, Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Pages } from '../contract/service/pages.js';
import type { PageId } from '../contract/wire/ids.js';

export const QUIET_MS = 5_000;

export const operatorInput = (page: PageId, leftMs: number) =>
  new GateRefusal(
    'operator-input',
    `the operator is working page ${page}: their input holds agent actions on it until it has been quiet for ${QUIET_MS / 1000} seconds, about ${Math.ceil(leftMs / 1000)} s from now`,
    [
      'wait, then read the page again with snapshot_page before acting: the operator may have changed it',
      'ask the operator whether to go on with this page',
    ],
  );

export const operatorQuiet = (pages: Pages['Service'], page: PageId): Effect.Effect<void, GateRefusal<'operator-input'>> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => {
    const at = pages.operated(page);
    return at === undefined || now - at >= QUIET_MS ? Effect.void : Effect.fail(operatorInput(page, QUIET_MS - (now - at)));
  });
