import { Schema } from 'effect';

export const HOLDER_STANDINGS = ['working', 'rested', 'failed', 'gone'] as const;

export const holderStandingSchema = Schema.Literals(HOLDER_STANDINGS);
export type HolderStanding = typeof holderStandingSchema.Type;

export type HolderState = { readonly standing: HolderStanding; readonly child: boolean; readonly team: string | null };

export const abandoned = (state: HolderState | undefined): boolean =>
  state !== undefined && (state.standing === 'gone' || (state.child && state.standing !== 'working'));
