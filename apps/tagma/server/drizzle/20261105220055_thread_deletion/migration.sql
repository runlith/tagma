CREATE TABLE `thread_deletion` (
	`thread_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`spawn_root_id` text NOT NULL,
	`name` text,
	`by` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_deletion_name_idx` ON `thread_deletion` (`owner_id`,`spawn_root_id`,`name`,`deleted_at`);