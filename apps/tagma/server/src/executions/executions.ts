import { executions as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { executionVerbs } from './cli.js';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { terminalsCapability } from './contract/wire/capability.js';
import type { ExecutionLive } from './contract/service/live.js';
import { ActingRun } from './contract/service/grants.js';
import { ServingGit } from './contract/service/git.js';
import { EXECUTION_FEEDS } from './contract/wire/feeds.js';
import { type ThreadWorld, WorldFiles } from './contract/service/worlds.js';
import { EXECUTION_SETTING_KEYS, EXECUTION_SETTING_SECTIONS } from './settings.js';
import { heldProcesses } from './doctrine/heldProcesses.js';
import { RELOCATIONS } from '../platform/contract/service/relocation.js';
import { executionRelocation } from './relocation.js';
import { HOME_FOLLOWERS } from '../thread-record/contract/service/homes.js';

const live: ExecutionLive = liveOf(EXECUTION_FEEDS, async (door) => {
  const { terminal, command, commandBytes, load } = (await import('./ports.js')).executionChannels({ executions: door });
  return { ...terminal, ...command, ...commandBytes, ...load };
});

export const executions = manifest({
  ...declaration,
  capabilities: [terminalsCapability],
  contributions: [
    ...RELOCATIONS.of(executionRelocation),
    ...HOME_FOLLOWERS.of({ id: 'executions/command-rules', load: async () => (await import('./homes.js')).executionHomes }),
  ],
  verbs: executionVerbs,
  bodies: async () => {
    const [
      { TERMINAL_READ_PAIRS },
      { TERMINAL_ACT_PAIRS },
      { LANE_PAIRS },
      { RESIDUAL_PAIRS },
      { COMMAND_PAIRS },
      { COMMAND_RULE_PAIRS },
      { MACHINE_PAIRS },
    ] = await Promise.all([
      import('./operations/terminalReads.js'),
      import('./operations/terminalActs.js'),
      import('./operations/lanes.js'),
      import('./operations/residuals.js'),
      import('./operations/commandCalls.js'),
      import('./operations/commandRules.js'),
      import('./operations/machine.js'),
    ]);
    return [
      ...Object.values(TERMINAL_READ_PAIRS),
      ...Object.values(TERMINAL_ACT_PAIRS),
      ...Object.values(LANE_PAIRS),
      ...Object.values(RESIDUAL_PAIRS),
      ...Object.values(MACHINE_PAIRS),
      ...Object.values(COMMAND_PAIRS),
      ...Object.values(COMMAND_RULE_PAIRS),
    ];
  },
  tables: async () => {
    const [
      { commandRule },
      {
        command,
        commandDelivery,
        commandFence,
        commandWait,
        custodyNotice,
        openTerminal,
        openTerminalProgress,
        terminal,
        terminalIntent,
        terminalRequestKey,
        terminalRequestKeyTally,
        terminalWriter,
      },
    ] = await Promise.all([import('./store/commandRule.js'), import('./store/terminal.js')]);
    return {
      entities: [commandRule, openTerminal, openTerminalProgress, terminal, terminalRequestKeyTally, terminalWriter],
      history: [command, commandDelivery, commandFence, commandWait, custodyNotice, terminalIntent, terminalRequestKey],
    };
  },
  live,
  settings: [...EXECUTION_SETTING_KEYS],
  settingSections: EXECUTION_SETTING_SECTIONS,
  sections: [
    {
      id: 'held-processes',
      place: { prompt: 50 },
      owner: 'executions',
      render: heldProcesses,
      path: 'src/executions/doctrine/heldProcesses.ts',
    },
  ],
  drivers: [{ id: 'request-key-retention' }, { id: 'terminal-grant-closes' }, { id: 'terminal-disposition' }],
  lifetimes: {
    installation: lazyLayer(
      () => import('./assembly.js'),
      ({ executionsLayer }) => executionsLayer,
    ),
    serving: lazyLayer(
      () => import('./serving.js'),
      ({ executionsServingLayer }) => executionsServingLayer,
    ),
    call: (input: { readonly servingGit: ServingGit['Service']; readonly world: ThreadWorld; readonly runId?: string | null }) =>
      Context.make(ServingGit, input.servingGit).pipe(
        Context.add(WorldFiles, { files: input.world.world.files }),
        Context.add(ActingRun, { runId: input.runId ?? null }),
      ),
  },
});
