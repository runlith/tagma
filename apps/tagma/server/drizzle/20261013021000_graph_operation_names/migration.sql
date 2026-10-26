UPDATE `thread_mandate`
SET `approves` = (
  SELECT json_group_array(CASE value
    WHEN 'claim_task' THEN 'claim_block'
    WHEN 'release_task' THEN 'release_block'
    WHEN 'ready_tasks' THEN 'ready_work'
    WHEN 'accept_proposal' THEN 'accept_amendment'
    WHEN 'reject_proposal' THEN 'reject_amendment'
    WHEN 'uphold_proposal' THEN 'uphold_amendment'
    WHEN 'revise_proposal' THEN 'revise_amendment'
    WHEN 'read_proposals' THEN 'read_amendments'
    WHEN 'enforce_rule' THEN 'enforce_law'
    WHEN 'set_rule_enabled' THEN 'set_law_enabled'
    WHEN 'check_rules' THEN 'check_law'
    ELSE value END)
  FROM json_each(`thread_mandate`.`approves`)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`approves`) = 'array' THEN `approves` ELSE '[]' END)
  WHERE type = 'text' AND value IN (
    'claim_task', 'release_task', 'ready_tasks', 'accept_proposal', 'reject_proposal', 'uphold_proposal',
    'revise_proposal', 'read_proposals', 'enforce_rule', 'set_rule_enabled', 'check_rules'
  )
);
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(CASE value
    WHEN 'claim_task' THEN 'claim_block'
    WHEN 'release_task' THEN 'release_block'
    WHEN 'ready_tasks' THEN 'ready_work'
    WHEN 'accept_proposal' THEN 'accept_amendment'
    WHEN 'reject_proposal' THEN 'reject_amendment'
    WHEN 'uphold_proposal' THEN 'uphold_amendment'
    WHEN 'revise_proposal' THEN 'revise_amendment'
    WHEN 'read_proposals' THEN 'read_amendments'
    WHEN 'enforce_rule' THEN 'enforce_law'
    WHEN 'set_rule_enabled' THEN 'set_law_enabled'
    WHEN 'check_rules' THEN 'check_law'
    ELSE value END)
  FROM json_each(`setting`.`value`)
)
WHERE `setting`.`key` = 'agent.approves' AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`setting`.`value`) = 'array' THEN `setting`.`value` ELSE '[]' END)
  WHERE type = 'text' AND value IN (
    'claim_task', 'release_task', 'ready_tasks', 'accept_proposal', 'reject_proposal', 'uphold_proposal',
    'revise_proposal', 'read_proposals', 'enforce_rule', 'set_rule_enabled', 'check_rules'
  )
);
--> statement-breakpoint
UPDATE `native_thread`
SET `profile` = json_set(`profile`, '$.overlay.tools', json((
  SELECT json_group_array(CASE value
    WHEN 'claim_task' THEN 'claim_block'
    WHEN 'release_task' THEN 'release_block'
    WHEN 'ready_tasks' THEN 'ready_work'
    WHEN 'accept_proposal' THEN 'accept_amendment'
    WHEN 'reject_proposal' THEN 'reject_amendment'
    WHEN 'uphold_proposal' THEN 'uphold_amendment'
    WHEN 'revise_proposal' THEN 'revise_amendment'
    WHEN 'read_proposals' THEN 'read_amendments'
    WHEN 'enforce_rule' THEN 'enforce_law'
    WHEN 'set_rule_enabled' THEN 'set_law_enabled'
    WHEN 'check_rules' THEN 'check_law'
    ELSE value END)
  FROM json_each(`native_thread`.`profile`, '$.overlay.tools')
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`profile`, '$.overlay.tools') = 'array'
    THEN json_extract(`profile`, '$.overlay.tools') ELSE '[]' END)
  WHERE type = 'text' AND value IN (
    'claim_task', 'release_task', 'ready_tasks', 'accept_proposal', 'reject_proposal', 'uphold_proposal',
    'revise_proposal', 'read_proposals', 'enforce_rule', 'set_rule_enabled', 'check_rules'
  )
);
