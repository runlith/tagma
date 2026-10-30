import type { Invocation } from '../platform/cli/verb.js';
import type { Effect } from 'effect';
import type { HookClient } from './hooks/door.js';
import type { HarnessDeclarations } from './hooks/rows.js';
import type { ServerCli } from './cli/server.js';

type VerbSource = () => Promise<Record<string, unknown>>;

export const externalHarnessVerbs = (
  hookBinding: () => Promise<(at: Invocation) => Effect.Effect<HookClient>>,
  serverBinding: () => Promise<ServerCli>,
  installedBinding: () => Promise<HarnessDeclarations>,
): Readonly<{ hook: VerbSource; 'harness-run': VerbSource }> => ({
  hook: async () => {
    const [{ hook }, connect] = await Promise.all([import('./cli/hook.js'), hookBinding()]);
    const { hookConnectOver } = await import('./hooks/door.js');
    const installed: HarnessDeclarations = async (machine, harness) => (await installedBinding())(machine, harness);
    return { hook: hook({ connect: hookConnectOver(connect), installed }) };
  },
  'harness-run': async () => {
    const [{ harnessRun }, server] = await Promise.all([import('./cli/harnessRun.js'), serverBinding()]);
    return { harnessRun: harnessRun(server) };
  },
});
