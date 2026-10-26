import { Context, type Effect } from 'effect';
import type { RestartRecord, RestartState, RestartRecordUnwritable, RestartWindow, RestartWindowRefused } from '../wire/restart.js';

export class RestartRecords extends Context.Service<
  RestartRecords,
  {
    readonly state: Effect.Effect<RestartState>;
    report(window: RestartWindow): Effect.Effect<RestartRecord, RestartWindowRefused | RestartRecordUnwritable>;
  }
>()('tagma/installation/RestartRecords') {}
