CREATE TABLE `thread_journal_place` (
	`thread_id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	CONSTRAINT `fk_thread_journal_place_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `thread_target_operation` ADD `home_id` integer;
