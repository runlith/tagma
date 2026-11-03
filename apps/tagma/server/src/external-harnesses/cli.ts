import type { Invocation } from '../platform/cli/verb.js';
import type { Effect } from 'effect';
import type { HookClient } from './hooks/door.js';
import type { HarnessCatalog } from './hooks/rows.js';
import type { ServerCli } from './cli/server.js';
import type { HostedPlaces } from './cli/harnessRun.js';

export const externalHarnessVerbs = (
  hookBinding: () => Promise<(at: Invocation) => Effect.Effect<HookClient>>,
  serverBinding: () => Promise<ServerCli>,
  catalogBinding: () => Promise<HarnessCatalog>,
  runnersBinding: () => Promise<HostedPlaces>,
) => ({
  hook: async () => {
    const [{ hook }, connect] = await Promise.all([import('./cli/hook.js'), hookBinding()]);
    const { hookConnectOver } = await import('./hooks/door.js');
    return { hook: hook({ connect: hookConnectOver(connect), catalog: catalogBinding }) };
  },
  'harness-run': async () => {
    const [{ harnessRun }, server, places] = await Promise.all([import('./cli/harnessRun.js'), serverBinding(), runnersBinding()]);
    return { harnessRun: harnessRun(server, places) };
  },
});
