CREATE TABLE `command_revision` (
	`execution_id` text NOT NULL,
	`installation` text NOT NULL,
	`incarnation` integer NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`execution_ms` integer NOT NULL,
	`ceiling_ms` integer NOT NULL,
	`actor` text NOT NULL,
	`cause` text NOT NULL,
	`accepted_at` integer NOT NULL,
	CONSTRAINT `command_revision_pk` PRIMARY KEY(`execution_id`, `revision`),
	CONSTRAINT `fk_command_revision_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE INDEX `command_revision_operation_idx` ON `command_revision` (`installation`,`operation_id`);