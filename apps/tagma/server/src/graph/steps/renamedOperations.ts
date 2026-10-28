export type Renames = readonly (readonly [string, string])[];

export const RENAMED_OPERATIONS = {
  contract: [
    ['claim_task', 'claim_block'],
    ['release_task', 'release_block'],
    ['ready_tasks', 'ready_work'],
    ['enforce_rule', 'enforce_law'],
    ['set_rule_enabled', 'set_law_enabled'],
    ['check_rules', 'check_law'],
  ],
  rules: [
    ['enforce_law', 'enforce_rule'],
    ['check_law', 'check_rules'],
    ['set_law_enabled', 'set_rule_enabled'],
    ['set_law_delivery', 'set_rule_delivery'],
  ],
} as const satisfies Record<string, Renames>;
