export type TerminalDestination = {
  readonly transport: 'pipes' | 'pty';
  readonly lifetime: 'call' | 'held';
  readonly rootId?: string;
  readonly launchedFor?: string;
};

export const terminalOpens = (terminal: TerminalDestination): boolean =>
  terminal.launchedFor !== undefined || (terminal.rootId !== undefined && (terminal.transport === 'pty' || terminal.lifetime === 'held'));
