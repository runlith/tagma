UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(
    CASE WHEN json_type(value, '$.spend') = 'integer'
      THEN json_set(value, '$.spend', CASE json_extract(value, '$.spend')
        WHEN 2 THEN 3 WHEN 3 THEN 5 WHEN 4 THEN 8 WHEN 5 THEN 10 ELSE json_extract(value, '$.spend') END)
      ELSE value
    END
  )) FROM (SELECT value FROM json_each(`setting`.`value`) ORDER BY key)
)
WHERE `key` = 'agent.models' AND json_valid(`value`) AND json_type(`value`) = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE type = 'object' AND json_type(value, '$.spend') = 'integer'
);
--> statement-breakpoint
UPDATE `thread_mandate`
SET `team` = json_set(`team`, '$.models', json((
  SELECT json_group_array(json(
    CASE WHEN json_type(value, '$.spend') = 'integer'
      THEN json_set(value, '$.spend', CASE json_extract(value, '$.spend')
        WHEN 2 THEN 3 WHEN 3 THEN 5 WHEN 4 THEN 8 WHEN 5 THEN 10 ELSE json_extract(value, '$.spend') END)
      ELSE value
    END
  )) FROM (SELECT value FROM json_each(`thread_mandate`.`team`, '$.models') ORDER BY key)
)))
WHERE json_valid(`team`) AND json_type(`team`, '$.models') = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`thread_mandate`.`team`, '$.models') WHERE type = 'object' AND json_type(value, '$.spend') = 'integer'
);
