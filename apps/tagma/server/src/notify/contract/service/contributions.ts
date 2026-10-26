import { Context, type Effect } from 'effect';
import type { Outcomes } from './outcomes.js';

export type SenderRegistration = (sender: string, receiver: Outcomes['Service']) => () => void;

export class NotificationContributions extends Context.Service<
  NotificationContributions,
  { declare(register: SenderRegistration): Effect.Effect<() => void> }
>()('notify/Contributions') {}
