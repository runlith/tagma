import { Context, type Effect } from 'effect';

export const ACTIVITY_DATABASE = 'activity.sqlite';

export class ActivityPlace extends Context.Service<
  ActivityPlace,
  {
    readonly dataPath: string | null;
    readonly migrations: string;
    readonly opened: Effect.Effect<void>;
  }
>()('tagma/activity/ActivityPlace') {}
