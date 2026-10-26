import type { ContentBlock } from '@runlith/acp/content';
import type { HostedContent, HostedMessage } from '../../contract/wire/hosted.js';
import { HISTORY_CLOSE, HISTORY_OPEN, historyPieces } from '../../contract/wire/historyText.js';

const blockOf = (part: HostedContent): ContentBlock =>
  part.type === 'text' ? { type: 'text', text: part.text } : { type: 'image', data: part.data, mimeType: part.mimeType };

export const historyBlocks = (history: readonly HostedMessage[]): readonly ContentBlock[] => [
  { type: 'text', text: HISTORY_OPEN },
  ...history.flatMap(historyPieces).map(blockOf),
  { type: 'text', text: HISTORY_CLOSE },
];
