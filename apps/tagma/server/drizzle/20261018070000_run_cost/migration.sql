ALTER TABLE `thread_run` ADD `cost` text;--> statement-breakpoint
UPDATE `thread_run`
SET `cost` = (
  SELECT json_set(`protocol_turn`.`cost`, '$.basis', 'list')
  FROM `protocol_turn`
  WHERE `protocol_turn`.`thread_id` = `thread_run`.`thread_id` AND `protocol_turn`.`turn` = `thread_run`.`id`
)
WHERE `id` IN (SELECT `turn` FROM `protocol_turn` WHERE `cost` IS NOT NULL);--> statement-breakpoint
ALTER TABLE `protocol_turn` DROP COLUMN `cost`;
