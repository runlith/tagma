import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import type { TagmaAppLaunchEnvironment, TagmaAppLaunchProvider, TagmaAppLaunchRequest } from './contract/service/launch.js';

export type LaunchEnvironment = TagmaAppLaunchEnvironment & { readonly fingerprint: string };

const fingerprintOf = (env: Readonly<Record<string, string>>): string =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(env).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))))
    .digest('hex');

export const makeEnvironments = () => {
  const providers = new Set<TagmaAppLaunchProvider>();
  return {
    provide: (provider: TagmaAppLaunchProvider) =>
      Effect.sync(() => {
        providers.add(provider);
        return () => void providers.delete(provider);
      }),
    of: Effect.fn('TagmaAppLaunches.of')(function* (request: TagmaAppLaunchRequest) {
      const env: Record<string, string> = {};
      const redact = new Set<string>();
      for (const provider of [...providers]) {
        const given = yield* provider(request);
        Object.assign(env, given.env);
        for (const value of given.redact) redact.add(value);
      }
      return { env, redact: [...redact], fingerprint: fingerprintOf(env) };
    }),
  };
};

export type LaunchEnvironments = ReturnType<typeof makeEnvironments>;
