INSERT INTO `setting` (`scope`, `project_id`, `key`, `value`, `declined`, `updated_at`)
SELECT 'project', rung.`project_id`, chosen.`key`, chosen.`value`, 0, rung.`updated_at`
FROM `setting` rung
JOIN `setting` chosen ON chosen.`scope` = 'user' AND chosen.`project_id` IS NULL AND chosen.`key` = CASE rung.`key`
  WHEN 'translation.reasoning' THEN 'translation.model'
  WHEN 'threads.titleReasoning' THEN 'threads.titleModel'
  WHEN 'threads.decisionReasoning' THEN 'threads.decisionModel'
END
WHERE rung.`scope` = 'project'
  AND rung.`key` IN ('translation.reasoning', 'threads.titleReasoning', 'threads.decisionReasoning')
  AND CASE WHEN json_valid(rung.`value`) THEN CASE WHEN json_type(rung.`value`) = 'text' THEN json_extract(rung.`value`, '$') <> '' ELSE 0 END ELSE 0 END
  AND CASE WHEN json_valid(chosen.`value`) THEN CASE WHEN json_type(chosen.`value`) = 'text' THEN instr(json_extract(chosen.`value`, '$'), ':') > 1 ELSE 0 END ELSE 0 END
  AND NOT EXISTS (
    SELECT 1 FROM `setting` own
    WHERE own.`scope` = 'project' AND own.`project_id` IS rung.`project_id` AND own.`key` = chosen.`key`
  );
--> statement-breakpoint
UPDATE `setting`
SET `value` = CASE
  WHEN json_extract(`value`, '$') = '' THEN 'null'
  ELSE json_object(
    'provider', substr(json_extract(`value`, '$'), 1, instr(json_extract(`value`, '$'), ':') - 1),
    'model', substr(json_extract(`value`, '$'), instr(json_extract(`value`, '$'), ':') + 1),
    'reasoning', (
      SELECT CASE WHEN json_valid(rung.`value`) THEN CASE WHEN json_type(rung.`value`) = 'text' THEN nullif(json_extract(rung.`value`, '$'), '') END END
      FROM `setting` rung
      WHERE rung.`key` = CASE `setting`.`key`
          WHEN 'translation.model' THEN 'translation.reasoning'
          WHEN 'threads.titleModel' THEN 'threads.titleReasoning'
          WHEN 'threads.decisionModel' THEN 'threads.decisionReasoning'
        END
        AND (
          (rung.`scope` = `setting`.`scope` AND rung.`project_id` IS `setting`.`project_id`)
          OR (`setting`.`scope` = 'project' AND rung.`scope` = 'user' AND rung.`project_id` IS NULL)
        )
      ORDER BY rung.`project_id` IS NULL
      LIMIT 1
    )
  )
END
WHERE `key` IN ('translation.model', 'threads.titleModel', 'threads.decisionModel')
  AND CASE
    WHEN json_valid(`value`) THEN CASE
      WHEN json_type(`value`) = 'text' THEN
        json_extract(`value`, '$') = ''
        OR (instr(json_extract(`value`, '$'), ':') > 1 AND instr(json_extract(`value`, '$'), ':') < length(json_extract(`value`, '$')))
      ELSE 0
    END
    ELSE 0
  END;
--> statement-breakpoint
DELETE FROM `setting` WHERE `key` IN ('translation.reasoning', 'threads.titleReasoning', 'threads.decisionReasoning');
