import type { ToolDisplay } from '@runlith/agent/tool/display';

export const CONTRACT_HEADER = 'tagma-contract';

export const OUTCOME_HEADER = 'tagma-outcome';

export const CALL_HEADER = 'tagma-call';

export const CALL_META = 'tagma/call';

export const APPROVAL_WAIT_HEADER = 'tagma-approval-wait-ms';

export const MEDIA_HEADER = 'tagma-media';

export const MEDIA_INLINE = 'inline';

export const ANSWER_HEADER = 'tagma-answer';

export const ANSWER_TEXT = 'text';

export type InlineMedia = { readonly mimeType: string; readonly data: string };

export type AnswerParts = {
  readonly document: unknown;
  readonly text: string | undefined;
  readonly media: readonly InlineMedia[];
  readonly display: ToolDisplay | undefined;
};

export const answerParts = (answered: unknown): AnswerParts => {
  if (typeof answered !== 'object' || answered === null || Array.isArray(answered))
    return { document: answered, text: undefined, media: [], display: undefined };
  const { _meta: meta, ...document } = answered as {
    readonly _meta?: { readonly text?: unknown; readonly media?: readonly InlineMedia[]; readonly toolDisplay?: ToolDisplay };
  };
  return { document, text: typeof meta?.text === 'string' ? meta.text : undefined, media: meta?.media ?? [], display: meta?.toolDisplay };
};

export const OUTCOMES = ['answer', 'negative', 'refusal', 'defect'] as const;

export type Outcome = (typeof OUTCOMES)[number];
