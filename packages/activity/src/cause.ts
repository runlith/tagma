import { Context } from 'effect';
import type { ActivityActor, ActivityTrigger } from './fact';

export type ActivityCause = {
  readonly actor: ActivityActor;
  readonly trigger: ActivityTrigger;
};

export const ActivityCause = Context.Reference<ActivityCause | null>('@runlith/activity/ActivityCause', {
  defaultValue: () => null,
});
