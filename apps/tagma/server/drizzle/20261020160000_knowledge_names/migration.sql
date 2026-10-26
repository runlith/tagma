UPDATE `setting`
SET `value` = (
  SELECT json_group_array(catalog) FROM (
    SELECT CASE value WHEN 'notes' THEN 'knowledge' ELSE value END AS catalog, min(key) AS at
    FROM json_each(`setting`.`value`)
    GROUP BY catalog
    ORDER BY at
  )
)
WHERE `setting`.`key` = 'graph.catalogs' AND EXISTS (
  SELECT 1 FROM json_each(CASE WHEN json_valid(`setting`.`value`) AND json_type(`setting`.`value`) = 'array'
    THEN `setting`.`value` ELSE '[]' END)
  WHERE type = 'text' AND value = 'notes'
);
