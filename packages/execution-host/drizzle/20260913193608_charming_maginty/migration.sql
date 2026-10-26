ALTER TABLE `command_revision` ADD `fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `command_revision` ADD `exception_actor` text;--> statement-breakpoint
ALTER TABLE `command_revision` ADD `exception_cause` text;--> statement-breakpoint
DROP INDEX IF EXISTS `command_revision_operation_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `command_revision_operation_idx` ON `command_revision` (`installation`,`operation_id`);
