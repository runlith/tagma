import { Context, type Effect } from 'effect';

export type SetupStanding = 'pending' | 'running' | 'failed';

export type TreeSetupStanding = {
  readonly of: (projectId: number, root: string) => Effect.Effect<SetupStanding | null>;
};

export const TreeSetupState = Context.Reference<TreeSetupStanding | null>('tagma/commit-steps/TreeSetupState', {
  defaultValue: () => null,
});
