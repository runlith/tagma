import { Context, type Effect } from 'effect';
import { ContributionPoint } from './contribution.js';

export type LiveWork = {
  readonly id: string;
  readonly ends: { readonly one: string; readonly many: string };
  readonly count: Effect.Effect<number, never, unknown>;
};

export const LIVE_WORK = new ContributionPoint<LiveWork>('platform/live-work');

export class LiveWorks extends Context.Service<LiveWorks, { readonly all: readonly LiveWork[] }>()('tagma/platform/LiveWorks') {}
