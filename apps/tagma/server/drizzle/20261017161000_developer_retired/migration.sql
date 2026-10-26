UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.id', 'tagma')
WHERE json_extract(`profile`, '$.overlay.baseAgentId') = 'developer' AND json_extract(`profile`, '$.id') = 'developer';
--> statement-breakpoint
UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.overlay.id', 'tagma')
WHERE json_extract(`profile`, '$.overlay.baseAgentId') = 'developer' AND json_extract(`profile`, '$.overlay.id') = 'developer';
--> statement-breakpoint
UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.overlay.baseAgentId', 'tagma')
WHERE json_extract(`profile`, '$.overlay.baseAgentId') = 'developer';
--> statement-breakpoint
UPDATE `native_thread` SET `transport` = json_set(`transport`, '$.agent', 'tagma') WHERE json_extract(`transport`, '$.agent') = 'developer';
--> statement-breakpoint
UPDATE `thread` SET `agent_id` = 'tagma' WHERE `agent_id` = 'developer';
--> statement-breakpoint
UPDATE `setting` SET `value` = '"tagma"' WHERE `key` = 'agent.default' AND `value` = '"developer"';
--> statement-breakpoint
DELETE FROM `setting` WHERE `key` = 'agent.default' AND `value` = 'null' AND `declined` = 0;
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(entry)) FROM (
    SELECT CASE WHEN json_extract(value, '$.type') = 'developer' THEN json_set(value, '$.type', 'tagma') ELSE json(value) END AS entry
    FROM json_each(`setting`.`value`)
    ORDER BY key
  )
)
WHERE `key` = 'agent.offered' AND json_valid(`value`) AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE json_extract(value, '$.type') = 'developer'
);
