ALTER TABLE `execution` ADD `command_scope` text;--> statement-breakpoint
ALTER TABLE `execution` ADD `command_owner` text;--> statement-breakpoint
ALTER TABLE `execution` ADD `command_cohort` text;--> statement-breakpoint
UPDATE `execution` SET `command_scope` = json_extract(`command`, '$.origin.scope'), `command_owner` = json_extract(`command`, '$.origin.owner'), `command_cohort` = json_extract(`command`, '$.origin.cohort') WHERE `command` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `execution_admitted_idx` ON `execution` (`created_at`,`execution_id`);--> statement-breakpoint
CREATE INDEX `execution_command_idx` ON `execution` (`command_scope`,`command_owner`,`command_cohort`,`created_at`,`execution_id`);