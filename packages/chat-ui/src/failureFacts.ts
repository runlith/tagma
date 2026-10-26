import type { ThreadFailureDiagnostics } from '@runlith/agent/transcript/entries';

export type FailureFact = {
  readonly label: string;
  readonly value: string;
  readonly note?: string | undefined;
  readonly mono?: boolean;
  readonly copy?: boolean;
};

export function failureFacts(
  diagnostics: ThreadFailureDiagnostics,
  providerLabel: string | null = diagnostics.provider,
): readonly FailureFact[] {
  const reason = diagnostics.reason;
  const status = diagnostics.httpStatus ?? reason?.status;
  const provider = diagnostics.provider;
  const retryable = diagnostics.retryable;
  const started = diagnostics.modelStarted;
  return [
    ...(provider === null
      ? []
      : [{ label: 'Provider', value: providerLabel ?? provider, note: providerLabel === provider ? undefined : provider }]),
    { label: 'Reason', value: diagnostics.type, note: reason?.kind },
    ...(status === undefined
      ? []
      : [
          {
            label: 'Response',
            value: `HTTP ${status}`,
            note: reason?.upstreamRequestId === undefined ? undefined : `request ${reason.upstreamRequestId}`,
          },
        ]),
    ...(retryable === null
      ? []
      : [
          {
            label: 'Retry',
            value: retryable ? 'Can be retried' : 'Not retried',
            note: retryable ? undefined : 'the same request fails the same way',
          },
        ]),
    ...(started === null ? [] : [{ label: 'Model', value: started ? 'Started' : 'Not started' }]),
    { label: 'Stage', value: diagnostics.stage, mono: true },
    { label: 'Run', value: diagnostics.record.runId, mono: true, copy: true },
    { label: 'Record', value: diagnostics.record.entryId, mono: true, copy: true },
  ];
}

export function failureRaw(text: string, diagnostics: ThreadFailureDiagnostics): string {
  const detail = diagnostics.httpStatus === undefined ? diagnostics.detail : undefined;
  return [text, detail, diagnostics.stack].filter((part): part is string => part !== undefined && part.trim() !== '').join('\n\n');
}

export function failureReport(parts: {
  readonly label: string;
  readonly text: string | null;
  readonly notes: readonly string[];
  readonly facts: readonly FailureFact[];
  readonly raw: string | null;
  readonly time: string | null;
}): string {
  const facts = parts.facts.map((fact) => `${fact.label}: ${fact.value}${fact.note === undefined ? '' : ` (${fact.note})`}`);
  return [
    parts.label,
    ...(parts.text === null ? [] : [parts.text.trim()]),
    ...parts.notes,
    ...(facts.length === 0 ? [] : ['', ...facts]),
    ...(parts.raw === null ? [] : ['', parts.raw.trim()]),
    ...(parts.time === null ? [] : ['', parts.time]),
  ].join('\n');
}
