import { TerminalRefused } from '../../../../executions/contract/wire/refusals.js';
import { terminalRefusal } from '../../../../executions/terminals/refusal.js';

export type HarnessFailureLine = { readonly text: string | null; readonly hostState: boolean };

export const refusalLine = (refusal: TerminalRefused): { readonly text: string; readonly hostState: boolean } => {
  const projected = terminalRefusal(refusal);
  return { text: `${projected.reason} — ${projected.unblock.join('; ')}`, hostState: refusal.reason === 'host-state' };
};
