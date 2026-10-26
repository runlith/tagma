import { OperationChecks } from '../invocation/contract/service/operationChecks.js';
import type { RuleChecks } from '../enforcement/contract/service/ruleChecks.js';
import { afterEditCheck, checkedOperation } from '../enforcement/operationChecks.js';
import { WORLD_TOOL_CHECKS } from './catalog.js';

export const operationChecks = (checks: RuleChecks['Service']): OperationChecks['Service'] =>
  OperationChecks.of({
    run: (id, actor, work) => checkedOperation(checks, id, actor, work),
    afterEdit: (ctx, tool) => afterEditCheck(checks, WORLD_TOOL_CHECKS, ctx, tool, (path) => ctx.places.resource(path)),
  });
