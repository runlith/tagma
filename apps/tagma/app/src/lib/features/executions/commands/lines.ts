import type { CommandEntry } from '@runlith/executions/protocol/inventory';
import { commandStartedAt, type CommandReading } from '@tagma/server/executions/contract/wire/commands';
import type { ProcessLine, ProcessLive, ProcessOwner, ProcessPhase } from '../processes/lines.js';
import { terminalKey } from '../Repo.js';

export function commandLine(reading: CommandReading, owner: ProcessOwner, root: string | null): ProcessLine {
  const view = reading.command;
  const address = { execution: view.execution.execution, incarnation: view.execution.incarnation };
  const live = reading.live;
  const entry = live._tag === 'Held' ? live.entry : null;
  const notes: string[] = [];
  if (view.cwd !== undefined && view.cwd !== root) notes.push(view.cwd);
  if (entry !== null && entry.state.purpose === 'internal') notes.push('Tagma internal');
  return {
    key: terminalKey(address),
    address,
    kind: 'command',
    transport: 'pipes',
    opens: false,
    printed: entry?.printed ?? null,
    owner: entry !== null && entry.state.purpose === 'internal' ? { ...owner, internal: true } : owner,
    wait: reading.wait?.mode ?? null,
    phase: entry === null ? null : entry.state.phase,
    live: LIVE_OF[live._tag],
    label: view.label ?? null,
    command: view.commandLine ?? view.program ?? null,
    cwd: view.cwd ?? null,
    note: notes.length === 0 ? null : notes.join(' · '),
    ports: [],
    startedAt: live._tag === 'Held' ? startOf(live.entry, live.readAt) : null,
    endedAt: null,
    ranMs: entry !== null && entry.state.phase === 'ended' ? (entry.deadline.elapsedMs ?? null) : null,
    exit: entry?.ending?.nativeExit ?? null,
    limit:
      entry === null
        ? null
        : {
            executionMs: entry.deadline.executionMs ?? null,
            ceilingMs: entry.deadline.ceilingMs ?? null,
            revision: entry.deadline.revision,
            expiresAt: entry.deadline.expiresAt ?? null,
            origin: entry.deadline.origin,
          },
    waitMs: view.time?.waitMs ?? null,
    stoppedByLimit: false,
    outer: false,
    unstarted: entry?.ending?.unacquired ?? null,
    place: view.rootId ?? null,
    current: reading.current?.command ?? null,
  };
}

const LIVE_OF: Record<CommandReading['live']['_tag'], ProcessLive> = {
  Held: 'held',
  Unheld: 'unheld',
  Unavailable: 'unavailable',
};

function startOf(entry: CommandEntry, readAt: number): number | null {
  return commandStartedAt(entry, readAt) ?? null;
}
