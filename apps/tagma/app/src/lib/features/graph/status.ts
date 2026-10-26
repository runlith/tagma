const STATUS_TEXT: Record<string, string> = {
  open: 'text-status-open',
  in_work: 'text-status-in-work',
  done: 'text-status-done',
  closed: 'text-status-closed',
  applied: 'text-status-done',
  rejected: 'text-status-closed',
  upheld: 'text-status-done',
};

export function statusText(status: string): string {
  return STATUS_TEXT[status] ?? 'text-muted-foreground';
}

const STATUS_COLOR: Record<string, string> = {
  open: 'var(--status-open)',
  in_work: 'var(--status-in-work)',
  done: 'var(--status-done)',
  closed: 'var(--status-closed)',
  applied: 'var(--status-done)',
  rejected: 'var(--status-closed)',
  upheld: 'var(--status-done)',
};

export const STATUS_NONE_VAR = 'var(--status-none)';

export function statusColor(status: string | null): string {
  return status === null ? STATUS_NONE_VAR : (STATUS_COLOR[status] ?? STATUS_NONE_VAR);
}

export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export const RESTING_STATES = ['done', 'closed', 'superseded', 'answered'] as const;
export type RestingState = (typeof RESTING_STATES)[number];

export function isRestingState(state: string): state is RestingState {
  return (RESTING_STATES as readonly string[]).includes(state);
}

export const RESTING_LABEL: Record<RestingState, string> = {
  done: 'done',
  closed: 'closed',
  superseded: 'superseded',
  answered: 'answered',
};

export type StateMark = { label: string; tone: 'status' | 'building' | 'muted' };

export const STATUS_OPS = ['claim_block', 'release_block', 'finish_block', 'close_block'] as const;
export type StatusOp = (typeof STATUS_OPS)[number];

export function isStatusOp(op: string): op is StatusOp {
  return (STATUS_OPS as readonly string[]).includes(op);
}

export type StatusAction = { readonly label: string; readonly to: string; readonly op: StatusOp | null };
