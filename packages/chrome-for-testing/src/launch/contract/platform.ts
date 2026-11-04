export type Failure = {
  readonly _tag: 'LaunchRefused';
  readonly problem: 'sandbox-unavailable' | 'display-unavailable' | 'libraries-unavailable' | 'launch-failed';
  readonly message: string;
  readonly unblock: readonly [string, ...string[]];
};

type Ready = {
  readonly _tag: 'Ready';
  readonly environment: NodeJS.ProcessEnv;
};

export type Preparation = Ready | Failure;

export type Platform = {
  prepare(windowed: boolean): Promise<Preparation>;
  failed(diagnostic: string): Failure;
};

export const failed = (diagnostic: string): Failure => ({
  _tag: 'LaunchRefused',
  problem: 'launch-failed',
  message: `the browser did not become ready:\n${diagnostic}`,
  unblock: ['correct the browser startup error above, then start the browser again'],
});
