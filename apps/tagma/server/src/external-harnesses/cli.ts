import type { Invocation } from '../platform/cli/verb.js';
import type { Effect } from 'effect';
import type { HookClient } from './hooks/door.js';
import type { HarnessCatalog } from './hooks/rows.js';
import type { ServerCli } from './cli/server.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const externalHarnessVerbs = (
  hookBinding: () => Promise<(at: Invocation) => Effect.Effect<HookClient>>,
  serverBinding: () => Promise<ServerCli>,
  catalogBinding: () => Promise<HarnessCatalog>,
): Readonly<{ hook: VerbSource; 'harness-run': VerbSource }> => ({
  hook: async () => {
    const [{ hook }, connect] = await Promise.all([import('./cli/hook.js'), hookBinding()]);
    const { hookConnectOver } = await import('./hooks/door.js');
    return { hook: hook({ connect: hookConnectOver(connect), catalog: catalogBinding }) };
  },
  'harness-run': async () => {
    const [{ harnessRun }, server] = await Promise.all([import('./cli/harnessRun.js'), serverBinding()]);
    return { harnessRun: harnessRun(server) };
  },
});
