import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { ModulePresentation } from '../platform/contract/service/presentation.js';
import type { SubmitReceipt } from './contract/wire/receipt.js';

const SHORT_SHA = 7;

const quoted = (subject: unknown): string | undefined =>
  typeof subject === 'string' && subject.trim() !== '' ? `“${subject.trim()}”` : undefined;

const receiptOf = (answer: unknown): SubmitReceipt | null => {
  const submitted = (answer as { readonly submitted?: SubmitReceipt } | null)?.submitted;
  return submitted === undefined ? null : submitted;
};

const subjectOf = (input: unknown): unknown => (input as { readonly subject?: unknown } | null)?.subject;

export const LANDING_PRESENTATION: ModulePresentation = {
  operations: ['submit_work'],
  called: (input) => ({ form: 'none', title: quoted(input.subject) }),
  settled: (input, answer): ToolDisplay | undefined => {
    const receipt = receiptOf(answer);
    if (receipt?.status === 'nothing') return { form: 'none', verb: 'Nothing to commit' };
    if (receipt?.status !== 'landed') return { form: 'none', title: quoted(subjectOf(input)) };
    const subject = receipt.subject ?? subjectOf(input);
    const files = receipt.committed.length;
    return {
      form: 'none',
      verb: 'Committed',
      title: receipt.commit.slice(0, SHORT_SHA),
      subtitle: typeof subject === 'string' && subject !== '' ? subject : undefined,
      facts: [{ label: files === 1 ? '1 file' : `${files} files` }],
      reference: { kind: 'commit', checkout: receipt.checkout, commit: receipt.commit },
    };
  },
  negative: (_input, answer) => (receiptOf(answer)?.status === 'refused' ? 'Git refused the commit' : 'Not committed'),
};
