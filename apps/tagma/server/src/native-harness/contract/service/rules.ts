import { Context } from 'effect';
import type { AgentRuleSource } from '@runlith/agent/AgentRuntimePolicy';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { Contributed } from '../../../platform/contract/wire/contribution.js';
import type { AgentDeclaration } from '../../agents/declaration.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import type { ThreadContext } from '../../turns/context.js';
import type { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import type { ThreadTeams } from '../../../threads/contract/service/team.js';

export type RuleSetup = {
  readonly declaration: AgentDeclaration;
  readonly definitions: CapabilityDefinitions;
  readonly mandate: ThreadMandate['Service'];
  readonly teams: ThreadTeams['Service'];
};

export type NativeRuleSource = AgentRuleSource<ThreadContext, RuleSetup>;
export const NATIVE_RULES = new ContributionPoint<NativeRuleSource>('native-harness/rules');
export class DeclaredNativeRules extends Context.Service<DeclaredNativeRules, readonly Contributed<NativeRuleSource>[]>()(
  'native-harness/DeclaredNativeRules',
) {}
