import type { ProcessReport } from '@runlith/executions/protocol/evidence';

export const foregroundOf = (report: ProcessReport | undefined): string | null | undefined => {
  if (report === undefined) return undefined;
  const beneath = report.processes.filter((row) => row.association !== undefined && row.association.relation !== 'leader');
  if (beneath.length === 0) return null;
  const named = beneath.map((row) => row.command?.trim() ?? '').find((command) => command.length > 0);
  return named ?? 'a process';
};
