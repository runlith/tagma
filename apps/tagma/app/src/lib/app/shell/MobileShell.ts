import { Effect } from 'effect';
import { type BesideOffer, PaneUnavailable, type ShellRefusal, type ThreadAddress } from '$lib/features/workspace/ShellOps.js';
import { RoutedShell } from './RoutedShell.js';

export class MobileShell extends RoutedShell {
  besideOffer(): BesideOffer {
    return 'none';
  }

  openThread(thread: ThreadAddress): Effect.Effect<void, ShellRefusal> {
    return this.inItsProject(thread);
  }

  openPane(kind: string): Effect.Effect<void, ShellRefusal> {
    return Effect.fail(new PaneUnavailable({ kind, message: 'This shell has no side panes.' }));
  }
}
