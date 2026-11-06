import { Context, Data, Effect } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import { BeforeBuild, type StepAsk, type StepVerdict } from '../wire/steps.js';

export const BEFORE_BUILD = new ContributionPoint<never, BeforeBuild>('checkout-builds/before-build', {
  name: 'beforeBuild',
  title: 'Checks before Tagma builds a checkout',
  schema: BeforeBuild,
});

export class BuildStepFailed extends Data.TaggedError('BuildStepFailed')<{ readonly message: string }> {}

export type BeforeStep = {
  readonly plugin: string;
  readonly title: string;
  readonly projectId: number;
  readonly ask: (input: StepAsk) => Effect.Effect<StepVerdict, BuildStepFailed>;
};

export type BuildSteps = {
  readonly of: (checkout: string) => Effect.Effect<readonly BeforeStep[], BuildStepFailed>;
};

export const BuildSteps = Context.Reference<BuildSteps>('tagma/checkout-builds/BuildSteps', {
  defaultValue: () => ({ of: () => Effect.succeed([]) }),
});
