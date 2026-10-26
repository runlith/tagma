import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import { Service } from '@runlith/layer/key';
import { CommandActivity } from '../commands/Activity.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import type { ExecutionAddress } from '../Repo.js';

const UNNAMED = 'an agent';
const READING = '…';

export type Held = { readonly holder: string | null; readonly revision: number };

export type Holding = { readonly thread: string; readonly label: string; readonly home: string | null | undefined };

export const heldOf = (record: TerminalRow['record']): Held => ({
  holder: record.holder === 'operator' ? null : (record.heldBy ?? record.holder),
  revision: record.revision,
});

export class TerminalHolders extends Service<TerminalHolders>()('TerminalHolders', { tier: 'project' }) {
  static *make() {
    const commands = yield* CommandActivity;
    return new TerminalHolders(() => commands.roster, yield* ThreadNames);
  }

  constructor(
    private readonly listings: () => readonly TerminalRow[],
    private readonly names: ThreadNames,
  ) {
    super();
  }

  of(address: ExecutionAddress): Held | undefined {
    const listing = this.listings().find(
      (candidate) =>
        candidate.record.execution.execution === address.execution && candidate.record.execution.incarnation === address.incarnation,
    );
    if (listing === undefined) return undefined;
    return heldOf(listing.record);
  }

  holding(thread: string): Holding {
    const words = this.names.of(thread);
    if (words === undefined) return { thread, label: READING, home: null };
    return { thread, label: words?.label ?? UNNAMED, home: words === null ? null : words.home };
  }
}
