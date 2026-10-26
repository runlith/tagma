UPDATE `native_thread`
SET `profile` = json_object(
  'id', 'developer',
  'overlay', json_object(
    'id', 'developer',
    'baseAgentId', 'developer',
    'description', '',
    'capabilities', json('["agents","files","shell","web","mcp","plugins","skills","threads","peers","resources","sandbox","worktrees","terminals","artifacts","reflections"]')
  )
)
WHERE `profile` IS NULL AND (
  json_extract(`transport`, '$.agent') = 'code'
  OR `id` IN (SELECT `id` FROM `thread` WHERE `agent_id` = 'code')
);
--> statement-breakpoint
UPDATE `native_thread`
SET `profile` = json_set(
  `profile`,
  '$.overlay.baseAgentId', 'developer',
  '$.overlay.capabilities', json(coalesce(
    json_extract(`profile`, '$.overlay.capabilities'),
    '["agents","files","shell","web","mcp","plugins","skills","threads","peers","resources","sandbox","worktrees","terminals","artifacts","reflections"]'
  ))
)
WHERE json_extract(`profile`, '$.overlay.baseAgentId') = 'code';
--> statement-breakpoint
UPDATE `native_thread` SET `transport` = json_set(`transport`, '$.agent', 'developer') WHERE json_extract(`transport`, '$.agent') = 'code';
--> statement-breakpoint
UPDATE `thread` SET `agent_id` = 'developer' WHERE `agent_id` = 'code';
--> statement-breakpoint
UPDATE `setting` SET `value` = '"developer"' WHERE `key` = 'agent.default' AND `value` = '"code"';
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(entry)) FROM (
    SELECT CASE WHEN json_extract(value, '$.type') = 'code' THEN json_set(value, '$.type', 'developer') ELSE json(value) END AS entry
    FROM json_each(`setting`.`value`)
    ORDER BY key
  )
)
WHERE `key` = 'agent.offered' AND json_valid(`value`) AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE json_extract(value, '$.type') = 'code'
);
