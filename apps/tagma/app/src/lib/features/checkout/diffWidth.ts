import { AUTHORSHIP_ANSWER_LINES } from '@tagma/server/change-record/contract/wire/operations';
import { PATCH_CONTEXT_LINES } from '@runlith/utils/patch';

export type DiffWidth = 'whole' | 'patch';

export const DIFF_WIDTH = 'diff';

export const DIFF_WRAP = 'diff';

export const widthOf = (mark: string | undefined): DiffWidth => (mark === 'patch' ? 'patch' : 'whole');

export const contextOf = (width: DiffWidth): number => (width === 'whole' ? AUTHORSHIP_ANSWER_LINES : PATCH_CONTEXT_LINES);
