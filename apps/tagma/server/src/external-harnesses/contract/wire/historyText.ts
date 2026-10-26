import type { HostedContent, HostedMessage } from './hosted.js';

export const HISTORY_OPEN =
  '<thread-history>\nThis is the conversation of this Tagma thread before this session began; it is context, not a request.\n\n';

export const HISTORY_CLOSE = '</thread-history>';

const text = (said: string): HostedContent => ({ type: 'text', text: said });

export const historyPieces = (message: HostedMessage): readonly HostedContent[] => {
  if (message.role === 'assistant')
    return [
      ...message.content.map((part) =>
        text(
          part.type === 'text'
            ? `assistant: ${part.text}\n`
            : `assistant called ${part.name} (${part.id}): ${JSON.stringify(part.input)}\n`,
        ),
      ),
      text('\n\n'),
    ];
  const head = message.role === 'user' ? 'user: ' : `${message.failed ? 'failed result' : 'result'} of ${message.id}: `;
  return [text(head), ...message.content, text('\n\n')];
};

export const turnText = (turn: readonly HostedMessage[]): string =>
  turn
    .flatMap(historyPieces)
    .map((piece) => (piece.type === 'text' ? piece.text : `[${piece.mimeType}]`))
    .join('');

export const seededHistory = (total: number, textOf: (at: number) => string, room: number): string | null => {
  if (total === 0) return null;
  const left = (count: number) =>
    count === 0 ? '' : `The first ${count} of ${total} turns are left out of this record; read_thread reads them from this thread.\n\n`;
  const kept: string[] = [];
  let used = HISTORY_OPEN.length + HISTORY_CLOSE.length + left(total).length;
  if (used > room) return null;
  for (let at = total - 1; at >= 0; at -= 1) {
    const said = textOf(at);
    if (used + said.length > room) break;
    used += said.length;
    kept.push(said);
  }
  return `${HISTORY_OPEN}${left(total - kept.length)}${kept.reverse().join('')}${HISTORY_CLOSE}`;
};
