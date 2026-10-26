export const TERMINAL_INPUT = 'tagma.terminal-input';

export const TERMINAL_REPLAY = 'tagma.terminal-replay';

export type TerminalInputStage = 'keydown' | 'sent' | 'receipt' | 'delivered' | 'parsed' | 'settled';

export type TerminalDeliveryRoad = 'inline' | 'queued';

export interface TerminalInputMark {
  readonly stage: TerminalInputStage;
  readonly sequence: number | null;
  readonly binding: string | null;
  readonly road: TerminalDeliveryRoad | null;
  readonly bytes: number | null;
}

export type TerminalReplayStage = 'fetch' | 'parse';

export interface TerminalReplayMark {
  readonly stage: TerminalReplayStage;
  readonly offset: string;
  readonly bytes: number | null;
}

const KEPT = 2048;
const written = new Map<string, number>();

function record(name: string, detail: TerminalInputMark | TerminalReplayMark): void {
  const standing = (written.get(name) ?? 0) + 1;
  if (standing > KEPT) {
    performance.clearMarks(name);
    written.set(name, 1);
  } else {
    written.set(name, standing);
  }
  performance.mark(name, { detail });
}

export function markTerminalInput(detail: TerminalInputMark): void {
  record(TERMINAL_INPUT, detail);
}

export function markTerminalReplay(detail: TerminalReplayMark): void {
  record(TERMINAL_REPLAY, detail);
}
