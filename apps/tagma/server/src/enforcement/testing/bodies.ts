import { Effect } from 'effect';
import type { CheckSubjectKind } from '../../platform/contract/wire/operation.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { Bound } from '../../platform/contract/service/body.js';
import { OperationSubjects } from '../contract/service/operationSubjects.js';
import type { Prepared } from '../rules/enforce.js';
import type { ModulesPrepared } from '../rules/modules.js';
import { ENFORCEMENT_PAIRS } from '../operationBodies.js';

type Pair = typeof ENFORCEMENT_PAIRS;
type Body<K extends keyof Pair> = Pair[K]['body'];
type Performs<K extends keyof Pair, P = undefined> = Bound<
  Parameters<Body<K>['execute']>[0],
  P,
  Effect.Success<ReturnType<Body<K>['execute']>>,
  Exclude<
    Effect.Services<ReturnType<Body<K>['execute']>> | (Body<K> extends { prepare: (...args: any) => infer W } ? Effect.Services<W> : never),
    OperationSubjects
  >,
  Effect.Error<ReturnType<Body<K>['execute']>>
>;

const enforce = ENFORCEMENT_PAIRS.enforce_rule.body;
const modules = ENFORCEMENT_PAIRS.set_module.body;

export const enforcementBodies = (subjectOf: (op: string) => CheckSubjectKind | null) => ({
  enforce_rule: {
    ...enforce,
    id: 'enforce_rule',
    prepare: (input: Parameters<Body<'enforce_rule'>['execute']>[0], caller: Caller) =>
      Effect.provideService(enforce.prepare!(input, caller), OperationSubjects, { of: subjectOf }),
  } as Performs<'enforce_rule', Prepared>,
  set_module: {
    ...modules,
    id: 'set_module',
    prepare: (input: Parameters<Body<'set_module'>['execute']>[0], caller: Caller) =>
      Effect.provideService(modules.prepare!(input, caller), OperationSubjects, { of: subjectOf }),
  } as Performs<'set_module', ModulesPrepared>,
  read_inspections: { ...ENFORCEMENT_PAIRS.read_inspections.body, id: 'read_inspections' } as Performs<'read_inspections'> &
    Pick<Body<'read_inspections'>, 'voice'>,
  check_rules: { ...ENFORCEMENT_PAIRS.check_rules.body, id: 'check_rules' } as unknown as Performs<
    'check_rules',
    Awaited<Effect.Success<ReturnType<NonNullable<Body<'check_rules'>['prepare']>>>>
  >,
  gate_commit: { ...ENFORCEMENT_PAIRS.gate_commit.body, id: 'gate_commit' } as Performs<'gate_commit'>,
  record_commit: { ...ENFORCEMENT_PAIRS.record_commit.body, id: 'record_commit' } as Performs<'record_commit'>,
  read_enforcement: { ...ENFORCEMENT_PAIRS.read_enforcement.body, id: 'read_enforcement' } as Performs<'read_enforcement'>,
});
