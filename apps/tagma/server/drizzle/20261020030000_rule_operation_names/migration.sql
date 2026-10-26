UPDATE `thread_mandate`
SET `approves` = (
  SELECT json_group_array(CASE value
    WHEN 'enforce_law' THEN 'enforce_rule'
    WHEN 'check_law' THEN 'check_rules'
    WHEN 'set_law_enabled' THEN 'set_rule_enabled'
    WHEN 'set_law_delivery' THEN 'set_rule_delivery'
    ELSE value END)
  FROM json_each(`thread_mandate`.`approves`)
)
WHERE EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`approves`) = 'array' THEN `approves` ELSE '[]' END)
  WHERE type = 'text' AND value IN ('enforce_law', 'check_law', 'set_law_enabled', 'set_law_delivery')
);
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(CASE value
    WHEN 'enforce_law' THEN 'enforce_rule'
    WHEN 'check_law' THEN 'check_rules'
    WHEN 'set_law_enabled' THEN 'set_rule_enabled'
    WHEN 'set_law_delivery' THEN 'set_rule_delivery'
    ELSE value END)
  FROM json_each(`setting`.`value`)
)
WHERE `setting`.`key` = 'agent.approves' AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`setting`.`value`) = 'array' THEN `setting`.`value` ELSE '[]' END)
  WHERE type = 'text' AND value IN ('enforce_law', 'check_law', 'set_law_enabled', 'set_law_delivery')
);
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(CASE value WHEN 'commit-steps' THEN 'format' ELSE value END)
  FROM json_each(`setting`.`value`)
)
WHERE `setting`.`key` = 'skills.disabled' AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`setting`.`value`) = 'array' THEN `setting`.`value` ELSE '[]' END)
  WHERE type = 'text' AND value = 'commit-steps'
);
--> statement-breakpoint
UPDATE `native_thread`
SET `profile` = json_set(`profile`, '$.overlay.tools', json((
  SELECT json_group_array(CASE value
    WHEN 'enforce_law' THEN 'enforce_rule'
    WHEN 'check_law' THEN 'check_rules'
    WHEN 'set_law_enabled' THEN 'set_rule_enabled'
    WHEN 'set_law_delivery' THEN 'set_rule_delivery'
    ELSE value END)
  FROM json_each(`native_thread`.`profile`, '$.overlay.tools')
)))
WHERE EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_type(`profile`, '$.overlay.tools') = 'array'
    THEN json_extract(`profile`, '$.overlay.tools') ELSE '[]' END)
  WHERE type = 'text' AND value IN ('enforce_law', 'check_law', 'set_law_enabled', 'set_law_delivery')
);
