import { openProcesses } from '../core/processes.ts';
import { openRun, REPORT_ENV, ROOT_ENV, sweepRuns } from '../core/run.ts';

export default async function setup(): Promise<void> {
  const processes = await openProcesses();
  const run = openRun({ pid: process.pid, start: processes.facts(process.pid)?.start ?? 0 });
  if (run.fresh) sweepRuns(processes);
  process.env[ROOT_ENV] = run.root;
  process.env[REPORT_ENV] = run.report;
}
