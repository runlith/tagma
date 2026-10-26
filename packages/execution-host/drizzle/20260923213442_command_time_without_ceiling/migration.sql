PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_command_revision` (
	`execution_id` text NOT NULL,
	`installation` text NOT NULL,
	`incarnation` integer NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`execution_ms` integer NOT NULL,
	`ceiling_ms` integer,
	`actor` text NOT NULL,
	`cause` text NOT NULL,
	`exception_actor` text,
	`exception_cause` text,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`accepted_at` integer NOT NULL,
	CONSTRAINT `command_revision_pk` PRIMARY KEY(`execution_id`, `revision`),
	CONSTRAINT `fk_command_revision_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
INSERT INTO `__new_command_revision`(`execution_id`, `installation`, `incarnation`, `revision`, `operation_id`, `fingerprint`, `execution_ms`, `ceiling_ms`, `actor`, `cause`, `exception_actor`, `exception_cause`, `outcome`, `accepted_at`) SELECT `execution_id`, `installation`, `incarnation`, `revision`, `operation_id`, `fingerprint`, `execution_ms`, `ceiling_ms`, `actor`, `cause`, `exception_actor`, `exception_cause`, `outcome`, `accepted_at` FROM `command_revision`;--> statement-breakpoint
DROP TABLE `command_revision`;--> statement-breakpoint
ALTER TABLE `__new_command_revision` RENAME TO `command_revision`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `command_revision_operation_idx` ON `command_revision` (`installation`,`operation_id`);--> statement-breakpoint
UPDATE `execution` SET `command` = json_remove(`command`, '$.workload', '$.enclosing', '$.limits.queueMs') WHERE json_type(`command`) = 'object';
