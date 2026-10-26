CREATE TABLE `invocation_call_place` (
	`thread_id` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`project_id` integer NOT NULL,
	`checkout` text,
	`branch` text,
	CONSTRAINT `invocation_call_place_pk` PRIMARY KEY(`thread_id`, `operation`, `key`),
	CONSTRAINT `fk_invocation_call_place_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
