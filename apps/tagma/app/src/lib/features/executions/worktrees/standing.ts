import type { ProcessReport } from '@runlith/executions/protocol/evidence';
import type { TerminalRow } from '@tagma/server/executions/contract/wire/terminals';
import type { StandingInPlace, StandingRun } from '$lib/features/worktrees/PlaceStanding.js';
import { foregroundOf } from '../processes/foreground.js';
import { isLive, isOperator, type ProcessLine } from '../processes/lines.js';
import { terminalKey, type ExecutionAddress } from '../Repo.js';

export type StandingSources = {
  readonly roster: () => readonly TerminalRow[];
  readonly lines: () => readonly ProcessLine[];
  readonly processes: (address: ExecutionAddress) => Promise<ProcessReport | undefined>;
  readonly thread: (threadId: string) => string;
};

const THREAD = 'thread:';

const OPERATOR = 'operator';

export const standing = (listing: TerminalRow): boolean => {
  const phase = listing.state?.phase;
  return phase === undefined || phase === 'running' || phase === 'starting';
};

export const placeStanding =
  (sources: StandingSources) =>
  async (rootId: string): Promise<StandingInPlace> => {
    const terminals = sources.roster().filter((listing) => listing.record.rootId === rootId && standing(listing));
    const read = await Promise.all(
      terminals.map(async (listing): Promise<StandingRun | null> => {
        const record = listing.record;
        const address = { execution: record.execution.execution, incarnation: record.execution.incarnation };
        const holder =
          record.launchedFor !== undefined
            ? sources.thread(record.launchedFor)
            : record.holder.startsWith(THREAD)
              ? sources.thread(record.holder.slice(THREAD.length))
              : record.holder === OPERATOR
                ? null
                : record.holder;
        const foreground = foregroundOf(await sources.processes(address));
        if (holder === null && foreground === null) return null;
        return { key: terminalKey(address), kind: 'terminal', what: foreground ?? record.commandLine ?? record.program ?? 'shell', holder };
      }),
    );
    const runs: StandingRun[] = read.flatMap((run) => (run === null ? [] : [run]));
    const idle = read.length - runs.length;
    for (const line of sources.lines()) {
      if (line.kind !== 'command' || line.place !== rootId || !isLive(line)) continue;
      runs.push({
        key: line.key,
        kind: 'command',
        what: line.label ?? line.command ?? 'command',
        holder: isOperator(line.owner) ? null : line.owner.label,
      });
    }
    return { runs, idle };
  };
