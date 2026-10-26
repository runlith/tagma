import { languageOf } from '@runlith/source-comments/languages';
import { readComments, stripProse, type Dropped } from '@runlith/source-comments';
import { textPatch } from '@runlith/utils/patch';
import { Effect } from 'effect';
import { ToolFailed } from '@runlith/agent/tool';
import { displayPath } from './display';
import type { ResolvedToolOptions } from './workspace';

export type Landing = { readonly text: string; readonly sentence: string };

export const withoutAddedProse = (
  resolved: ResolvedToolOptions,
  target: string,
  before: string,
  after: string,
): Effect.Effect<Landing, ToolFailed> =>
  resolved.comments(target).pipe(
    Effect.mapError(
      (error) =>
        new ToolFailed({
          reason: `The comment policy over ${displayPath(resolved.cwd, target)} could not be read, so nothing was written: ${error.message}`,
        }),
    ),
    Effect.map((policy) => (policy === 'forbid' ? stripped(resolved, target, before, after) : { text: after, sentence: '' })),
  );

function stripped(resolved: ResolvedToolOptions, target: string, before: string, after: string): Landing {
  if (languageOf(target) === null) return { text: after, sentence: '' };
  const reading = readComments(target, after);
  if (!reading.lexed) {
    return {
      text: after,
      sentence: ` comments not stripped: ${displayPath(resolved.cwd, target)} does not lex (${reading.reason}).`,
    };
  }
  if (!reading.comments.some((comment) => comment.kind === 'prose')) return { text: after, sentence: '' };
  const stripped = stripProse(target, after, addedLines(before, after));
  return { text: stripped.text, sentence: droppedSentence(stripped.dropped) };
}

//! The patch aligns lines on their trimmed text, so a landed line is judged on its BYTES against the one it came from.
function addedLines(before: string, after: string): ReadonlySet<number> {
  const standing = before.split('\n');
  const landed = after.split('\n');
  const written = new Set<number>();
  let atBefore = 1;
  let atAfter = 1;
  const judge = (): void => {
    if (standing[atBefore - 1] !== landed[atAfter - 1]) written.add(atAfter);
    atBefore += 1;
    atAfter += 1;
  };
  for (const hunk of textPatch(before, after).hunks) {
    while (atAfter < hunk.afterStart) judge();
    for (const line of hunk.lines) {
      if (line.kind === 'added') {
        written.add(atAfter);
        atAfter += 1;
        continue;
      }
      if (line.kind === 'removed') {
        atBefore += 1;
        continue;
      }
      judge();
    }
  }
  while (atAfter <= landed.length) judge();
  return written;
}

function droppedSentence(dropped: readonly Dropped[]): string {
  if (dropped.length === 0) return '';
  const lines = dropped.map((entry) => `L${entry.line}`).join(', ');
  const plural = dropped.length === 1 ? 'line' : 'lines';
  return ` Dropped ${dropped.length} prose comment ${plural} (${lines} of the text this change wrote): a why lives in a doc on path#Symbol.`;
}
