export type TerminalDestination = {
  readonly transport: 'pipes' | 'pty';
  readonly lifetime: 'call' | 'held';
  readonly rootId?: string;
  readonly launchedFor?: string;
  readonly heldBy?: string;
};

export const UNPLACED = 'unplaced';

export const terminalPlace = (terminal: TerminalDestination): string | null => {
  if (terminal.launchedFor !== undefined || (terminal.transport !== 'pty' && terminal.lifetime !== 'held')) return null;
  return terminal.rootId ?? (terminal.heldBy === undefined ? null : UNPLACED);
};

export const terminalOpens = (terminal: TerminalDestination): boolean =>
  terminal.launchedFor !== undefined || terminalPlace(terminal) !== null;
