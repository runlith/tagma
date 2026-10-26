export const COMMAND_FOLD = 'tagma.command-fold';

export interface CommandFoldMark {
  readonly owners: number;
  readonly records: number;
}

const KEPT = 256;
let written = 0;

export function markCommandFold(detail: CommandFoldMark): void {
  written += 1;
  if (written > KEPT) {
    performance.clearMarks(COMMAND_FOLD);
    written = 1;
  }
  performance.mark(COMMAND_FOLD, { detail });
}
