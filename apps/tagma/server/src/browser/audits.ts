import { pageRows } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { Automation } from './contract/service/automation.js';
import { AUDIT_NODES } from './contract/wire/audit.js';
import { AUDIT_OPERATIONS as AUDIT, type AuditOperationId } from './contract/wire/auditOperations.js';
import { pageOf } from './operations.js';

const NODES_CEILING = ceilingOf(AUDIT_NODES);

export const AUDIT_PAIRS: { readonly [K in AuditOperationId]: OperationPair<(typeof AUDIT)[K]> } = {
  audit_page: pair(
    AUDIT.audit_page,
    body(AUDIT.audit_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const audited = yield* (yield* Automation).audit(
          page,
          { within: input.within, tags: input.tags, limit: pageRows(input.limit, AUDIT_NODES, NODES_CEILING) },
          thread,
        );
        return { status: 'audited' as const, ...audited };
      }),
    }),
  ),
};
