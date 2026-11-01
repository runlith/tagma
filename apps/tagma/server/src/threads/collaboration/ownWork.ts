import { Effect } from 'effect';
import { OWN_ENDINGS, OwnWork } from '../contract/service/ownWork.js';
import { ThreadRows } from '../contract/service/rows.js';

export const makeOwnWork = Effect.map(ThreadRows, (rows) => OwnWork.of({ owing: rows.owing, endings: OWN_ENDINGS }));
