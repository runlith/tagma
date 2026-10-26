CREATE TABLE `activity` (
	`id` text PRIMARY KEY,
	`parent` text,
	`project` integer,
	`thread` text,
	`run` text,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`trigger` text,
	`attrs` text NOT NULL,
	`opened_at` integer NOT NULL,
	`ended_at` integer,
	`outcome` text,
	`reason` text,
	`message` text,
	`result` text,
	`provider` text,
	`model` text,
	`rung` text,
	`account` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`reasoning_tokens` integer
, `parent_run` text, `folded` text);
--> statement-breakpoint
CREATE TABLE `body` (
	`activity` text NOT NULL,
	`n` integer NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`bucket` text NOT NULL,
	`bytes` integer NOT NULL,
	`state` text NOT NULL,
	`base_activity` text,
	`base_n` integer, `form` text DEFAULT 'value' NOT NULL, `size` integer DEFAULT 0 NOT NULL, `content_type` text DEFAULT 'application/json' NOT NULL,
	CONSTRAINT `body_pk` PRIMARY KEY(`activity`, `n`)
);
--> statement-breakpoint
CREATE TABLE `bucket` (
	`bucket` text PRIMARY KEY,
	`bytes` integer NOT NULL,
	`bodies` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loss` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`at` integer NOT NULL,
	`cause` text NOT NULL,
	`facts` integer NOT NULL,
	`bodies` integer NOT NULL,
	`bytes` integer NOT NULL
, `until` integer DEFAULT 0 NOT NULL, `unknown` integer DEFAULT 0 NOT NULL);
--> statement-breakpoint
CREATE TABLE `note` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`activity` text NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL
, `folded` text);
--> statement-breakpoint
CREATE TABLE `reading` (
	`id` text PRIMARY KEY,
	`question` text NOT NULL,
	`expires` integer NOT NULL,
	`matched` integer NOT NULL,
	`total` integer NOT NULL
, `threads` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `reading_member` (
	`reading` text NOT NULL,
	`thread` text NOT NULL,
	`expires` integer NOT NULL,
	CONSTRAINT `reading_member_pk` PRIMARY KEY(`reading`, `thread`)
);
--> statement-breakpoint
CREATE TABLE `reading_row` (
	`reading` text NOT NULL,
	`n` integer NOT NULL,
	`identity` text,
	`answer` text,
	CONSTRAINT `reading_row_pk` PRIMARY KEY(`reading`, `n`)
);
--> statement-breakpoint
CREATE TABLE `upgrade` (
	`name` text PRIMARY KEY,
	`finished_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_ended` ON `activity` (`ended_at`);
--> statement-breakpoint
CREATE INDEX `activity_opened` ON `activity` (`opened_at`);
--> statement-breakpoint
CREATE INDEX `activity_parent` ON `activity` (`parent`);
--> statement-breakpoint
CREATE INDEX `activity_project_at` ON `activity` (`project`,`opened_at`);
--> statement-breakpoint
CREATE INDEX `activity_run` ON `activity` (`run`);
--> statement-breakpoint
CREATE INDEX `activity_thread_at` ON `activity` (`thread`,`opened_at`);
--> statement-breakpoint
CREATE INDEX `body_at` ON `body` (`at`);
--> statement-breakpoint
CREATE INDEX `body_base` ON `body` (`base_activity`,`base_n`);
--> statement-breakpoint
CREATE INDEX `body_bucket` ON `body` (`bucket`);
--> statement-breakpoint
CREATE INDEX `loss_at` ON `loss` (`at`);
--> statement-breakpoint
CREATE INDEX `loss_until` ON `loss` (`until`);
--> statement-breakpoint
CREATE INDEX `note_activity` ON `note` (`activity`);
--> statement-breakpoint
CREATE INDEX `note_at` ON `note` (`at`);
--> statement-breakpoint
CREATE INDEX `reading_expires` ON `reading` (`expires`);
--> statement-breakpoint
CREATE INDEX `reading_identity` ON `reading_row` (`reading`,`identity`);
--> statement-breakpoint
CREATE INDEX `reading_member_expires` ON `reading_member` (`expires`);
--> statement-breakpoint
CREATE TRIGGER `body_deleted` AFTER DELETE ON `body` WHEN old.`state` = 'written' BEGIN
	UPDATE `bucket` SET `bytes` = `bytes` - old.`bytes`, `bodies` = `bodies` - 1 WHERE `bucket` = old.`bucket`;
END;
--> statement-breakpoint
CREATE TRIGGER `body_unwritten` AFTER UPDATE OF `state` ON `body` WHEN old.`state` = 'written' AND new.`state` <> 'written' BEGIN
	UPDATE `bucket` SET `bytes` = `bytes` - old.`bytes`, `bodies` = `bodies` - 1 WHERE `bucket` = old.`bucket`;
END;
--> statement-breakpoint
CREATE TRIGGER `body_written` AFTER INSERT ON `body` WHEN new.`state` = 'written' BEGIN
	INSERT INTO `bucket` (`bucket`, `bytes`, `bodies`) VALUES (new.`bucket`, new.`bytes`, 1)
	ON CONFLICT (`bucket`) DO UPDATE SET `bytes` = `bytes` + excluded.`bytes`, `bodies` = `bodies` + 1;
END;
