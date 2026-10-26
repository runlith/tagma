import type { DowngradeReady, DowngradeStep } from '../contract/wire/downgrade.js';

const STEP_NAMES: Record<DowngradeStep['step'], string> = {
  'downgrade-preflight': 'downgrade preflight',
  'console-key-rollback': 'console-key rollback',
};

export const downgradeLines = ({ steps, losses }: DowngradeReady): string[] => [
  ...steps.map((step) => `${STEP_NAMES[step.step]}: ${step.state} — ${step.detail}`),
  ...losses.map((loss) => `lost ${loss.owner} ${loss.table} ${loss.key}: ${loss.reason}`),
];

export function downgradeText(ready: DowngradeReady): string {
  return downgradeLines(ready).join('\n');
}
