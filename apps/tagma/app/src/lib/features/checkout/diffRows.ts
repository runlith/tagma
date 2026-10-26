import type { PathAuthorship } from '@tagma/server/change-record/contract/wire/authorship';
import { holderKey } from '@tagma/server/workspace/contract/wire/checkout';
import type { DiffLine, Mark } from '@runlith/code-editor/marks';
import { type Hand, handName } from './DiffReading.svelte.js';

const markOf = (hand: Hand): Mark => ({
  id: hand.key,
  label: `Written by ${handName(hand)}`,
  colour: hand.hue,
});

export function diffRows(answer: PathAuthorship, hands: readonly Hand[]): readonly DiffLine[] {
  const marks = new Map(hands.map((hand) => [hand.key, markOf(hand)]));
  return answer.lines.map((line) => ({
    kind: line.kind,
    text: line.text,
    before: line.before,
    after: line.after,
    mark: line.author === null ? null : (marks.get(holderKey(line.author.holder)) ?? null),
    spans: line.spans,
    hiddenBefore: line.hiddenBefore,
    hiddenAt: line.hiddenAt,
  }));
}
