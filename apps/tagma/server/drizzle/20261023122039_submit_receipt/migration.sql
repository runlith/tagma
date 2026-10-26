CREATE TABLE `submit_receipt` (
	`thread_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`call_id` text NOT NULL,
	`checkout` text NOT NULL,
	`ref` text NOT NULL,
	`job` text NOT NULL,
	`commit` text NOT NULL,
	`submitted` text NOT NULL,
	`complete` integer NOT NULL,
	CONSTRAINT `submit_receipt_pk` PRIMARY KEY(`thread_id`, `project_id`, `call_id`)
);
