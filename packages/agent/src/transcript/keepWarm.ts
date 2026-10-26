export const KEEP_WARM_SIGNAL_TYPE = 'keep-warm';

export type KeepWarmPing = {
  readonly anchor: string;
  readonly ping: number;
};

export function keepWarmSignalId({ anchor, ping }: KeepWarmPing): string {
  return `${KEEP_WARM_SIGNAL_TYPE}:${anchor}:${ping}`;
}

export function keepWarmPingOf(signalId: string): KeepWarmPing | null {
  const [kind, anchor, number, ...rest] = signalId.split(':');
  if (kind !== KEEP_WARM_SIGNAL_TYPE || anchor === undefined || anchor === '' || rest.length > 0) return null;
  const ping = Number(number);
  return Number.isInteger(ping) && ping > 0 ? { anchor, ping } : null;
}
