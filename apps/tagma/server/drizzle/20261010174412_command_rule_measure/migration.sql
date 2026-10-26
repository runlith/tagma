ALTER TABLE `command_rule` ADD `measure` text DEFAULT 'life' NOT NULL;--> statement-breakpoint
UPDATE `command_rule` SET `position` = `position` + 1
WHERE `thread_id` IS NULL AND EXISTS (
  SELECT 1 FROM `setting` AS `s`
  WHERE `s`.`key` = 'command.defaultMs' AND `s`.`declined` = 0 AND `s`.`value` IS NOT NULL
    AND ((`s`.`scope` = 'user' AND `command_rule`.`project_id` IS NULL) OR (`s`.`scope` = 'project' AND `s`.`project_id` = `command_rule`.`project_id`))
);--> statement-breakpoint
INSERT INTO `command_rule` (`id`, `project_id`, `thread_id`, `position`, `through`, `program`, `measure`, `limit_ms`, `writer`, `written_at`, `words`)
SELECT lower(hex(randomblob(4))), CASE WHEN `scope` = 'project' THEN `project_id` END, NULL, 0, NULL, NULL, 'life',
  MIN(CAST(`value` AS INTEGER), 21600000), 'operator', `updated_at`, 'the default command time setting, carried into a life rule'
FROM `setting`
WHERE `key` = 'command.defaultMs' AND `declined` = 0 AND `value` IS NOT NULL AND CAST(`value` AS INTEGER) > 0
  AND (`scope` = 'user' OR (`scope` = 'project' AND `project_id` IS NOT NULL));--> statement-breakpoint
DELETE FROM `setting` WHERE `key` = 'command.defaultMs';
