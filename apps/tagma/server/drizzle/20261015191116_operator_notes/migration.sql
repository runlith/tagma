CREATE TABLE `operator_note` (
	`scope_kind` text NOT NULL,
	`scope_key` text NOT NULL,
	`project_id` integer,
	`thread_id` text,
	`note_id` text NOT NULL,
	`text` text,
	`switch` text,
	`written_at` integer NOT NULL,
	CONSTRAINT `operator_note_pk` PRIMARY KEY(`scope_kind`, `scope_key`, `note_id`),
	CONSTRAINT `fk_operator_note_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_operator_note_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
