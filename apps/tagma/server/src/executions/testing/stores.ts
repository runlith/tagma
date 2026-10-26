import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { Effect, Stream } from 'effect';
import { Custody } from '../contract/service/custody.js';
import { makeCommandRows } from '../store/commandRows.js';
import { makeCommandDeliveries } from '../store/deliveries.js';
import { makeTerminalIntents } from '../store/intentLifecycle.js';
import { makeRequestKeys } from '../store/requestKeys.js';
import { makeTerminalRows } from '../store/terminalRows.js';

export const storesOver = (db: StoreDb<'machine'>, installation: InstallationId, options: { readonly retainedKeys?: number } = {}) => {
  const requestKeys = makeRequestKeys({ db, installation, retainedKeys: options.retainedKeys });
  const deliveries = makeCommandDeliveries({ db, installation });
  return {
    requestKeys,
    intents: makeTerminalIntents({ db, installation, keys: requestKeys }),
    terminalRows: makeTerminalRows({ db, installation }),
    commandRows: makeCommandRows({ db, installation, deliveries }),
    deliveries,
  };
};

export type Stores = ReturnType<typeof storesOver>;

const unusedCustody = () => Effect.die('this fixture provides only persisted custody readings');

export const holdsOf = (stores: Stores): Custody['Service'] =>
  Custody.of({
    fencesOf: stores.intents.fencesOf,
    heldBy: stores.terminalRows.heldBy,
    holdingUses: stores.terminalRows.holdingUses,
    move: unusedCustody,
    takeOver: unusedCustody,
    get displaced(): Custody['Service']['displaced'] {
      throw new Error('this fixture does not publish custody notices');
    },
    pendingNotices: unusedCustody,
    noticeDecided: unusedCustody,
    noticeDelivered: unusedCustody,
    stillDisplaced: unusedCustody,
    moves: () => Stream.die('this fixture does not publish custody moves'),
    disown: unusedCustody,
    disownThreads: unusedCustody,
    disownProject: unusedCustody,
    disownGone: unusedCustody,
  });
