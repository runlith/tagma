import type { Effect } from 'effect';
import type { Invocation } from '../platform/cli/verb.js';

export type ArtifactsDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: 'list_artifacts' };
      readonly query: { readonly cwd: string };
      readonly headers: Record<string, string | number | undefined>;
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export type ArtifactsCli = {
  readonly ask: <A>(call: (door: ArtifactsDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
};

export const artifactsVerbs = (binding: () => Promise<ArtifactsCli>) => ({
  artifacts: async () => {
    const [{ artifactsList }, port] = await Promise.all([import('./cli/list.js'), binding()]);
    return { artifacts: artifactsList(port) };
  },
});
