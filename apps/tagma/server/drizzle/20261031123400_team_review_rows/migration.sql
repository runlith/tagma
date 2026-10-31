INSERT INTO `setting` (`scope`, `project_id`, `key`, `value`, `declined`, `session_id`, `updated_at`)
SELECT `review`.`scope`, `review`.`project_id`, 'agent.models', '[]', 0, NULL, `review`.`updated_at`
FROM `setting` AS `review`
WHERE `review`.`key` = 'agent.review' AND json_valid(`review`.`value`) AND json_type(`review`.`value`, '$.pool') = 'array'
  AND (
    json_array_length(`review`.`value`, '$.pool') > 0
    OR (`review`.`scope` = 'project' AND json_array_length((
      SELECT `machine`.`value` FROM `setting` AS `machine`
      WHERE `machine`.`key` = 'agent.review' AND `machine`.`scope` = 'user' AND json_valid(`machine`.`value`)
    ), '$.pool') > 0)
  )
  AND NOT EXISTS (
    SELECT 1 FROM `setting` AS `models`
    WHERE `models`.`key` = 'agent.models' AND `models`.`scope` = `review`.`scope`
      AND coalesce(`models`.`project_id`, 0) = coalesce(`review`.`project_id`, 0)
  );
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(`item`)) FROM (
    SELECT `value` AS `item`, 0 AS `part`, `key` AS `at`
    FROM json_each(CASE WHEN json_valid(`setting`.`value`) AND json_type(`setting`.`value`) = 'array' THEN `setting`.`value` ELSE '[]' END)
    UNION ALL
    SELECT json_set(`inherited`.`value`, '$.reviews', json('false')), 1, `inherited`.`key`
    FROM json_each((
      SELECT `machine`.`value` FROM `setting` AS `machine`
      WHERE `machine`.`key` = 'agent.review' AND `machine`.`scope` = 'user' AND json_valid(`machine`.`value`)
    ), '$.pool') AS `inherited`
    WHERE `setting`.`scope` = 'project'
      AND json_type((
        SELECT `own`.`value` FROM `setting` AS `own`
        WHERE `own`.`key` = 'agent.review' AND `own`.`scope` = 'project' AND `own`.`project_id` = `setting`.`project_id` AND json_valid(`own`.`value`)
      ), '$.pool') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each((
          SELECT `own`.`value` FROM `setting` AS `own`
          WHERE `own`.`key` = 'agent.review' AND `own`.`scope` = 'project' AND `own`.`project_id` = `setting`.`project_id` AND json_valid(`own`.`value`)
        ), '$.pool') AS `kept`
        WHERE json_extract(`kept`.`value`, '$.provider') = json_extract(`inherited`.`value`, '$.provider')
          AND json_extract(`kept`.`value`, '$.model') = json_extract(`inherited`.`value`, '$.model')
          AND json_extract(`kept`.`value`, '$.reasoning') IS json_extract(`inherited`.`value`, '$.reasoning')
      )
    UNION ALL
    SELECT json_set(`value`, '$.reviews', json('true')), 2, `key`
    FROM json_each((
      SELECT `own`.`value` FROM `setting` AS `own`
      WHERE `own`.`key` = 'agent.review' AND `own`.`scope` = `setting`.`scope`
        AND coalesce(`own`.`project_id`, 0) = coalesce(`setting`.`project_id`, 0) AND json_valid(`own`.`value`)
    ), '$.pool')
    ORDER BY `part`, `at`
  )
)
WHERE `key` = 'agent.models' AND EXISTS (
  SELECT 1 FROM `setting` AS `own`
  WHERE `own`.`key` = 'agent.review' AND `own`.`scope` = `setting`.`scope`
    AND coalesce(`own`.`project_id`, 0) = coalesce(`setting`.`project_id`, 0)
    AND json_valid(`own`.`value`) AND json_type(`own`.`value`, '$.pool') = 'array'
    AND (
      json_array_length(`own`.`value`, '$.pool') > 0
      OR (`own`.`scope` = 'project' AND json_array_length((
        SELECT `machine`.`value` FROM `setting` AS `machine`
        WHERE `machine`.`key` = 'agent.review' AND `machine`.`scope` = 'user' AND json_valid(`machine`.`value`)
      ), '$.pool') > 0)
    )
);
--> statement-breakpoint
UPDATE `setting`
SET `value` = json_remove(
  CASE WHEN json_extract(`value`, '$.split') = 'same' THEN json_set(`value`, '$.lenses', json('[]')) ELSE `value` END,
  '$.pool',
  '$.split'
)
WHERE `key` = 'agent.review' AND json_valid(`value`)
  AND (json_type(`value`, '$.pool') IS NOT NULL OR json_type(`value`, '$.split') IS NOT NULL);
--> statement-breakpoint
UPDATE `thread_mandate`
SET `team` = json_set(`team`, '$.models', json((
  SELECT json_group_array(json(`item`)) FROM (
    SELECT `value` AS `item`, 0 AS `part`, `key` AS `at` FROM json_each(`thread_mandate`.`team`, '$.models')
    UNION ALL
    SELECT json_set(`value`, '$.reviews', json('true')), 1, `key` FROM json_each(`thread_mandate`.`team`, '$.review.pool')
    ORDER BY `part`, `at`
  )
)))
WHERE json_valid(`team`) AND json_type(`team`, '$.review.pool') = 'array' AND json_array_length(`team`, '$.review.pool') > 0;
--> statement-breakpoint
UPDATE `thread_mandate`
SET `team` = json_remove(
  CASE WHEN json_extract(`team`, '$.review.split') = 'same' THEN json_set(`team`, '$.review.lenses', json('[]')) ELSE `team` END,
  '$.review.pool',
  '$.review.split'
)
WHERE json_valid(`team`)
  AND (json_type(`team`, '$.review.pool') IS NOT NULL OR json_type(`team`, '$.review.split') IS NOT NULL);
