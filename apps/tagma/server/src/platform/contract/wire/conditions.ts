import { Duration } from 'effect';
import type { Approval, Condition } from '@runlith/agent/permissions';

export const ASKS_NEVER: Approval = { asksFrom: 'never' };

export const ASKS_IN_REVIEW: Approval = { asksFrom: 'review', timeout: 'none' };

const TEN_MINUTES = Duration.minutes(10);

const condition = (id: string, label: string, asksFrom: string, timeout: Condition['timeout']): Condition => ({
  id,
  label,
  asksFrom,
  timeout,
});

export const OUTSIDE_SUBTREE = condition('outside-subtree', 'Outside your subtree', 'review', TEN_MINUTES);
export const OWN_LINEAGE = condition('own-lineage', 'Own lineage', 'review', 'none');
export const THREAD_RUNNING = condition('thread-running', 'Working', 'review', TEN_MINUTES);
export const MODE_WITHHELD = condition('mode-withheld', 'Mode withheld', 'trust', 'none');
export const THREAD_ARCHIVED = condition('thread-archived', 'Thread archived', 'review', 'none');
export const COMMAND_CEILING = condition('command-ceiling', 'Command ceiling', 'trust', 'none');
export const NOT_HOLDER = condition('not-holder', 'Not the holder', 'review', TEN_MINUTES);
export const DEBT_GROWS = condition('debt-grows', 'Debt grows', 'review', 'none');
export const DEBT_UNOWNED = condition('debt-unowned', 'Debt unowned', 'review', 'none');
export const AGENT_RUNNING = condition('agent-running', 'Agent running', 'review', 'none');
export const ROOT_IN_USE = condition('root-in-use', 'Root in use', 'review', 'none');
export const UNCOMMITTED = condition('uncommitted', 'Uncommitted', 'review', 'none');
export const INSTALL_RUNNING = condition('install-running', 'Install running', 'review', TEN_MINUTES);
export const NO_WAY_BACK = condition('no-way-back', 'No way back', 'review', 'none');
export const MCP_ENV_RESOLVING = condition('mcp-env-resolving', 'Environment resolved', 'review', 'none');
