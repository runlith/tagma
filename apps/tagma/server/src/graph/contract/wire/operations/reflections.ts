import { Schema } from 'effect';
import { ASKS_IN_REVIEW } from '../../../../platform/contract/wire/conditions.js';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { blockResultFields } from '../answers.js';
import { blockMention, line } from '../fields.js';
import { GRAPH_ACT } from './shared.js';

export const REFLECTION_OPERATIONS = {
  answer_reflection: operation('answer_reflection', {
    ...GRAPH_ACT,
    approval: ASKS_IN_REVIEW,
    place: 'fixed',
    meaning:
      'Answer a reflection with what fixed it — a finished block, or the landed commit of a direct fix — or with a check on current code that found it no longer reproduces or no defect of Tagma.',
    confirmation: (input) => ({
      summary: `Answer reflection ${input.blockId} with ${input.by ?? (input.commit === undefined ? `the check: ${input.checked ?? '?'}` : `commit ${input.commit}`)}?`,
      consequence: 'The entry leaves the standing friction, answered by what you named; its filed facts stay as they were.',
    }),
    confirmLabel: 'Answer',
    presentation: { running: 'Answering a reflection', done: 'Answered a reflection' },
    subjects: () => [],
    grammar:
      'Name exactly one: `by`, finished work — a done/closed task or a rule stating what holds now — or `commit`, the fix a direct edit landed, which must name a commit of the checkout that holds the reflection’s graph and stand on that checkout’s branch; the full sha is recorded; or `checked`, what a check on current code found when nothing needed fixing — the conditions it ran under and why the entry no longer reproduces or is no defect of Tagma — recorded with the HEAD of that checkout and the time. Work that grew out of the friction needs no call: linked discovered-from, it answers when it ends. The same answer again returns the entry unchanged; a different one refuses and names the standing answer. Recurrence after a fix is a new reflection.',
    input: Schema.Struct({
      blockId: blockMention.annotate({ description: 'The reflection.' }),
      by: Schema.optional(blockMention).annotate({ description: 'The finished block that answered it.' }),
      commit: Schema.optional(line).annotate({
        description: 'The commit of a direct fix: a sha, short sha or other revision of the checkout that holds the reflection’s graph.',
      }),
      checked: Schema.optional(line).annotate({
        description: 'What a check on current code found, when nothing needed fixing: the conditions checked and the evidence.',
      }),
    }),
    refusals: [
      'not-found',
      'deleted',
      'not-a-reflection',
      'answer-shape',
      'not-finished',
      'already-answered',
      'self-answer',
      'cross-project',
      'commit-unknown',
      'commit-unlanded',
      'git-refused',
      'git-unreadable',
      'git-incomplete',
    ],
    answer: arms({ ok: blockResultFields }),
  }),

  unanswer_reflection: operation('unanswer_reflection', {
    ...GRAPH_ACT,
    approval: ASKS_IN_REVIEW,
    place: 'fixed',
    meaning:
      'Withdraw an answer a reflection stands answered by in error — named by an answer act, or finished work filed discovered-from it — keeping the answer’s history, the block and its edges.',
    confirmation: (input) => ({
      summary: `Withdraw ${input.by ?? (input.commit === undefined ? 'the recorded check' : `commit ${input.commit}`)} as the answer to reflection ${input.blockId}?`,
      consequence: 'That answer stops answering the entry; if nothing else answers it, it stands in the friction again.',
    }),
    confirmLabel: 'Withdraw',
    presentation: { running: 'Withdrawing an answer', done: 'Withdrew an answer' },
    subjects: () => [],
    grammar:
      'Name exactly one answer to withdraw: `by`, a block an answer act named or one filed discovered-from the entry, `commit`, a commit an answer act recorded — a prefix naming one of them will do — or `checked: true`, the check an answer act recorded. The withdrawal is its own journal entry: the answer act, the block and its discovered-from edge all stay. Only the named answer is withdrawn, so another answer — a newer correct one included — keeps standing, and the entry returns to the standing friction when none is left. The same withdrawal again changes nothing; answering with the same block or commit afterwards answers again. Something that never answered the entry refuses and names what answers it now.',
    input: Schema.Struct({
      blockId: blockMention.annotate({ description: 'The reflection.' }),
      by: Schema.optional(blockMention).annotate({ description: 'The block whose answer to withdraw.' }),
      commit: Schema.optional(line).annotate({ description: 'The recorded commit whose answer to withdraw.' }),
      checked: Schema.optional(Schema.Literal(true)).annotate({ description: 'Withdraw the recorded check.' }),
    }),
    refusals: ['not-found', 'deleted', 'not-a-reflection', 'answer-shape', 'not-an-answer'],
    answer: arms({ ok: blockResultFields }),
  }),
};
