UPDATE `thread` SET `harness` = 'claude-code' WHERE `harness` = 'claude';
--> statement-breakpoint
UPDATE `thread` SET `agent_id` = 'harness:claude-code' WHERE `agent_id` = 'harness:claude';
--> statement-breakpoint
UPDATE `session` SET `harness` = 'claude-code' WHERE `harness` = 'claude';
--> statement-breakpoint
UPDATE `external_session` SET `facet` = json_set(`facet`, '$.name', 'claude-code') WHERE json_extract(`facet`, '$.name') = 'claude';
--> statement-breakpoint
UPDATE `native_thread` SET `transport` = json_set(`transport`, '$.profile', 'claude-code') WHERE json_extract(`transport`, '$.profile') = 'claude';
--> statement-breakpoint
UPDATE `native_thread` SET `transport` = json_set(`transport`, '$.agent', 'harness:claude-code') WHERE json_extract(`transport`, '$.agent') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.id', 'harness:claude-code') WHERE json_extract(`profile`, '$.id') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.overlay.id', 'harness:claude-code') WHERE json_extract(`profile`, '$.overlay.id') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `profile` = json_set(`profile`, '$.overlay.baseAgentId', 'harness:claude-code') WHERE json_extract(`profile`, '$.overlay.baseAgentId') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `pending_definition` = json_set(`pending_definition`, '$.agentId', 'harness:claude-code') WHERE json_extract(`pending_definition`, '$.agentId') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `pending_definition` = json_set(`pending_definition`, '$.profile.id', 'harness:claude-code') WHERE json_extract(`pending_definition`, '$.profile.id') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `pending_definition` = json_set(`pending_definition`, '$.profile.overlay.id', 'harness:claude-code') WHERE json_extract(`pending_definition`, '$.profile.overlay.id') = 'harness:claude';
--> statement-breakpoint
UPDATE `native_thread` SET `pending_definition` = json_set(`pending_definition`, '$.profile.overlay.baseAgentId', 'harness:claude-code') WHERE json_extract(`pending_definition`, '$.profile.overlay.baseAgentId') = 'harness:claude';
--> statement-breakpoint
UPDATE `setting` SET `value` = json_remove(json_set(`value`, '$."claude-code"', json_extract(`value`, '$.claude')), '$.claude')
WHERE `key` = 'threads.harnessProfile' AND json_type(`value`, '$.claude') IS NOT NULL;
--> statement-breakpoint
UPDATE `setting` SET `value` = '"harness:claude-code"' WHERE `key` = 'agent.default' AND `value` = '"harness:claude"';
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(entry)) FROM (
    SELECT CASE WHEN json_extract(value, '$.type') = 'harness:claude' THEN json_set(value, '$.type', 'harness:claude-code') ELSE json(value) END AS entry
    FROM json_each(`setting`.`value`)
    ORDER BY key
  )
)
WHERE `key` = 'agent.offered' AND json_valid(`value`) AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE json_extract(value, '$.type') = 'harness:claude'
);
