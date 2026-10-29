CREATE TABLE `translation_act` (
	`project_id` integer NOT NULL,
	`block` text NOT NULL,
	`language` text NOT NULL,
	`model` text NOT NULL,
	`rung` text,
	`at` integer NOT NULL,
	`ending` text,
	`reason` text,
	`failed` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `translation_act_pk` PRIMARY KEY(`project_id`, `block`, `language`)
);
--> statement-breakpoint
CREATE TABLE `translation_part` (
	`project_id` integer NOT NULL,
	`block` text NOT NULL,
	`language` text NOT NULL,
	`source` text NOT NULL,
	`text` text NOT NULL,
	CONSTRAINT `translation_part_pk` PRIMARY KEY(`project_id`, `block`, `language`, `source`)
);
