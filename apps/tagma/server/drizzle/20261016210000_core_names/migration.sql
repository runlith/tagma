UPDATE `setting`
SET `value` = (
  SELECT json_group_array(id) FROM (
    SELECT DISTINCT CASE value WHEN 'lode' THEN 'core' ELSE value END AS id
    FROM json_each(`setting`.`value`)
  )
)
WHERE `setting`.`key` = 'graph.catalogs' AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_valid(`setting`.`value`) AND json_type(`setting`.`value`) = 'array'
    THEN `setting`.`value` ELSE '[]' END)
  WHERE type = 'text' AND value = 'lode'
);
