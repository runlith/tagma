CREATE TABLE `thread_base` (
	`thread_id` text NOT NULL,
	`depth` integer NOT NULL,
	`source_id` text NOT NULL,
	`low_ord` integer NOT NULL,
	`high_ord` integer NOT NULL,
	`after_position` integer NOT NULL,
	`through_position` integer NOT NULL,
	`prompts` text NOT NULL,
	`hidden` text NOT NULL,
	CONSTRAINT `thread_base_pk` PRIMARY KEY(`thread_id`, `depth`),
	CONSTRAINT `fk_thread_base_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `thread_base_source_idx` ON `thread_base` (`source_id`);