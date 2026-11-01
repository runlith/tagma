import { Layer } from '@runlith/layer/Layer';
import { ServedAddresses } from '$lib/features/browser/served.js';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { PlaceStanding } from '$lib/features/worktrees/PlaceStanding.js';
import { placeStanding } from './worktrees/standing.js';
import { ThreadNames } from '../../shared/threads/Names.svelte.js';
import { CommandActivity } from './commands/Activity.svelte.js';
import { TerminalAppearance } from './appearance/Settings.svelte.js';
import { TerminalHolders } from './terminal/Holders.svelte.js';
import { TerminalKeymap } from './terminal/Keymap.js';
import { TerminalOutput } from './terminal/Output.js';
import { Terminals } from './worktrees/Terminals.svelte.js';
import { TerminalRenderPolicy } from './terminal/RenderPolicy.js';
import { TerminalViews } from './terminal/Views.svelte.js';
import { TerminalTabs } from './terminal/Tabs.svelte.js';
import { ExecutionsRepo } from './Repo.js';
import { isLive } from './processes/lines.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { PaletteActions } from '$lib/features/workspace/action.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { actions } from './actions.js';
import { panes } from './panes.js';
import { sections } from './settings.js';

export const TerminalsLayer = Layer.mergeAll(
  Panes.contribute('executions', ...panes),
  SettingSections.contribute('executions', ...sections),
  PaletteActions.contribute('executions', { id: 'executions', actions }),
  ExecutionsRepo,
  SettingsRepo,
  TerminalAppearance,
  TerminalKeymap,
  TerminalOutput,
  TerminalRenderPolicy,
  TerminalViews,
  TerminalTabs,
  Terminals,
  CommandActivity,
  TerminalHolders,
  Layer.provide(PlaceStanding, function* () {
    const commands = yield* CommandActivity;
    const repo = yield* ExecutionsRepo;
    const names = yield* ThreadNames;
    return new PlaceStanding(
      placeStanding({
        roster: () => commands.roster,
        lines: () => commands.lines,
        processes: async (address) => {
          try {
            return (await repo.processes.key(address).refresh({ throwOnError: true }))?.report;
          } catch {
            return undefined;
          }
        },
        thread: (threadId) => names.of(threadId)?.label ?? threadId.slice(0, 8),
      }),
    );
  }),
  Layer.provide(ServedAddresses, function* () {
    const commands = yield* CommandActivity;
    return {
      get addresses() {
        return commands.lines
          .filter(isLive)
          .flatMap((line) =>
            line.ports.flatMap((port) => (port.url === null ? [] : [{ url: port.url, label: line.label ?? line.command ?? port.url }])),
          );
      },
    };
  }),
);
