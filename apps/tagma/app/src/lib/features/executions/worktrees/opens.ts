export type TerminalDestination = {
  readonly transport: 'pipes' | 'pty';
  readonly lifetime: 'call' | 'held';
  readonly rootId?: string;
  readonly launchedFor?: string;
  readonly heldBy?: string;
};

export type TerminalPlace = { readonly kind: 'checkout'; readonly rootId: string } | { readonly kind: 'holder'; readonly thread: string };

export const terminalPlace = (terminal: TerminalDestination): TerminalPlace | null => {
  if (terminal.launchedFor !== undefined || (terminal.transport !== 'pty' && terminal.lifetime !== 'held')) return null;
  if (terminal.rootId !== undefined) return { kind: 'checkout', rootId: terminal.rootId };
  return terminal.heldBy === undefined ? null : { kind: 'holder', thread: terminal.heldBy };
};

export const terminalOpens = (terminal: TerminalDestination): boolean =>
  terminal.launchedFor !== undefined || terminalPlace(terminal) !== null;
