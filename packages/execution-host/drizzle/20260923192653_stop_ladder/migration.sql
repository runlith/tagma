ALTER TABLE `stop_intent` DROP COLUMN `policy`;--> statement-breakpoint
UPDATE `call` SET `budget` = json_remove(`budget`, '$.stop') WHERE json_type(`budget`, '$.stop') IS NOT NULL;
