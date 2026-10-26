CREATE TABLE `spent_key` (
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`incarnation` integer,
	`kind` text NOT NULL,
	CONSTRAINT `spent_key_pk` PRIMARY KEY(`installation`, `operation_id`)
);
--> statement-breakpoint
ALTER TABLE `incarnation` ADD `evicting` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `operation` ADD `incarnation` integer;--> statement-breakpoint
CREATE TABLE `generation_ledger` (
	`incarnation` integer PRIMARY KEY NOT NULL REFERENCES `incarnation`(`incarnation`),
	`bytes` integer DEFAULT 0 NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL
);
