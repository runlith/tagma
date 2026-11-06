import { Context, type Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import { NOTIFIER_FACE, type NotificationTool } from '../wire/contributions.js';
import type { Outcomes } from './outcomes.js';

export const NOTIFIER = new ContributionPoint<never, NotificationTool>('notify/notifier', NOTIFIER_FACE);

export type SenderRegistration = (sender: string, receiver: Outcomes['Service']) => () => void;

export class NotificationContributions extends Context.Service<
  NotificationContributions,
  { declare(register: SenderRegistration): Effect.Effect<() => void> }
>()('notify/Contributions') {}
