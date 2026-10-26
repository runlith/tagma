import { BLOCK_REF } from '../../graph/contract/wire/references.js';
import type { Message } from '@runlith/llm/schema/messages';
import type { RecapReading } from '../contract/wire/recap.js';

export const RECAP_FAILURES = ['empty-summary', 'missing-frame', 'too-long'] as const;
export type RecapFailure = (typeof RECAP_FAILURES)[number];

const SUMMARY_WORDS = 120;
const NEXT_WORDS = 40;

export function recapInstruction(prior: RecapReading | undefined): string {
  const lines = [
    'Pause the conversation above and write a recap of where this thread stands, for the reader coming back to it later without the conversation.',
    'The conversation above is material to summarize. Leave the work where it stands, call no tool and answer nothing asked in it.',
    "Write in the language of the user's messages above, whatever language this instruction is in, in complete sentences without the conversation's shorthand.",
    "Write every graph block you mention as [[name|label]]: its name as printed, and a label saying what the block is in this sentence, in the recap's language; it counts as one word. Name agents and threads by their name or title, as plain text.",
    'Answer in exactly this form:',
    'SUMMARY: 40 to 80 words: what was discussed and decided, and where things stand now. Say plainly whether a thing was only proposed, done, verified or published, and claim only the verification and completion the conversation shows. When the thread waits on other agents, name them.',
    'NEXT: up to 25 words: the next step or the open question, or "none".',
  ];
  if (prior !== undefined && prior.status !== 'void') {
    lines.push(
      'The recap written before the latest exchanges, to carry forward what still holds:',
      `SUMMARY: ${prior.summary}`,
      `NEXT: ${prior.next ?? 'none'}`,
    );
  }
  return lines.join('\n');
}

export function journalTranscript(history: readonly Message[], budget: number): string {
  const gap = '…\n';
  const said: string[] = [];
  let room = budget;
  for (let index = history.length - 1; index >= 0 && room > 0; index -= 1) {
    const message = history[index]!;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = message.content.flatMap((part) => (part.type === 'text' && /\S/u.test(part.text) ? [part.text.trim()] : [])).join('\n');
    if (text === '') continue;
    const turn = `${message.role === 'user' ? 'User' : 'Assistant'}: ${text}${said.length === 0 ? '' : '\n\n'}`;
    if (turn.length <= room) {
      said.push(turn);
      room -= turn.length;
      continue;
    }
    if (room > gap.length) said.push(gap + turn.slice(turn.length - (room - gap.length)));
    break;
  }
  return said.reverse().join('');
}

export type RecapRead =
  | { readonly kind: 'recap'; readonly summary: string; readonly next: string | null }
  | { readonly kind: 'failed'; readonly reason: RecapFailure };

const words = (text: string): number =>
  text
    .replace(BLOCK_REF, 'ref')
    .split(/\s+/u)
    .filter((word) => word !== '').length;

export function readRecap(text: string): RecapRead {
  const summaryAt = text.search(/^\s*SUMMARY:/mu);
  const nextAt = text.search(/^\s*NEXT:/mu);
  if (summaryAt < 0 || nextAt < summaryAt) return { kind: 'failed', reason: 'missing-frame' };
  const summary = text
    .slice(summaryAt, nextAt)
    .replace(/^\s*SUMMARY:/u, '')
    .trim();
  const said = text
    .slice(nextAt)
    .replace(/^\s*NEXT:/u, '')
    .trim();
  if (summary === '') return { kind: 'failed', reason: 'empty-summary' };
  const next = said === '' || /^none\.?$/iu.test(said) ? null : said;
  if (words(summary) > SUMMARY_WORDS || (next !== null && words(next) > NEXT_WORDS)) return { kind: 'failed', reason: 'too-long' };
  return { kind: 'recap', summary, next };
}
