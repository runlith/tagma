CREATE TABLE `command_signature` (
	`repository` text NOT NULL,
	`signature` text NOT NULL,
	`runs` text NOT NULL,
	`streak` integer NOT NULL,
	`hit_at` integer,
	`hit_path` text,
	CONSTRAINT `command_signature_pk` PRIMARY KEY(`repository`, `signature`)
);
