CREATE TABLE `thread_place` (
	`thread_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`root` text NOT NULL,
	`entered_at` integer NOT NULL,
	CONSTRAINT `thread_place_pk` PRIMARY KEY(`thread_id`, `project_id`),
	CONSTRAINT `fk_thread_place_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
