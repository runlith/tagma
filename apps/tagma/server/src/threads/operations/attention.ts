import { page, pageRows, pastKey, readCursor, type PageQuestion } from '@runlith/paging';
import { Effect } from 'effect';
import { body, pair, type OperationPair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { ThreadList } from '../contract/service/list.js';
import { ATTENTION } from '../contract/wire/attention.js';
import { ATTENTION_OPERATIONS as OPS } from '../contract/wire/operations/attention.js';
import { ATTENTION_ORDER, attentionRows, projectNames, type Ranked } from '../list/attention.js';
import { declaredRefusals } from '../refusalAnswers.js';

const QUESTION: PageQuestion = { operation: 'read_attention', selection: {}, order: ATTENTION.order };

const keyOf = (ranked: Ranked) => ranked.key;

export const ATTENTION_PAIRS = {
  read_attention: pair(
    OPS.read_attention,
    body(OPS.read_attention, {
      execute: Effect.fnUntraced(function* (input) {
        const at = input.cursor === undefined ? null : readCursor(input.cursor, QUESTION);
        if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
        const ranked = yield* declaredRefusals(OPS.read_attention)(attentionRows(yield* ThreadList, projectNames(yield* Projects)));
        const rest = at === null ? ranked : pastKey(ranked, keyOf, ATTENTION_ORDER, at.at);
        const size = pageRows(input.limit, ATTENTION, ceilingOf(ATTENTION));
        const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf, question: QUESTION, total: ranked.length });
        return { status: 'ok' as const, rows: cut.rows.map((entry) => entry.row), total: ranked.length, cursor: cut.next };
      }),
    }),
  ),
} satisfies Record<string, OperationPair>;
