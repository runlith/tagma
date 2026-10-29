UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(
    CASE type
      WHEN 'object' THEN json_remove(value, '$.connector')
      WHEN 'text' THEN json_quote(value)
      WHEN 'true' THEN 'true'
      WHEN 'false' THEN 'false'
      WHEN 'null' THEN 'null'
      ELSE value
    END
  )) FROM (SELECT key, type, value FROM json_each(`setting`.`value`) ORDER BY key)
)
WHERE `key` = 'mcp.servers' AND json_valid(`value`) AND json_type(`value`) = 'array'
  AND EXISTS (SELECT 1 FROM json_each(`setting`.`value`) WHERE type = 'object' AND json_type(value, '$.connector') IS NOT NULL);
