CREATE TABLE `thread_copy` (
	`thread_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`root` text NOT NULL,
	`entered_at` integer NOT NULL,
	CONSTRAINT `thread_copy_pk` PRIMARY KEY(`thread_id`, `project_id`, `root`),
	CONSTRAINT `fk_thread_copy_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `thread_copy` (`thread_id`, `project_id`, `root`, `entered_at`)
SELECT `thread_id`, `project_id`, `root`, `entered_at` FROM `thread_place`;
