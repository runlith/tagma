CREATE TABLE `host_custody` (
	`installation` text PRIMARY KEY,
	`revision` integer NOT NULL,
	`epoch` integer NOT NULL,
	`holder_connection` text,
	`holder_incarnation` integer,
	`operation_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `host_custody` (`installation`, `revision`, `epoch`, `updated_at`) SELECT `installation`, 0, MAX(`epoch`), CAST(strftime('%s','now') AS INTEGER) * 1000 FROM `incarnation` GROUP BY `installation`;--> statement-breakpoint
ALTER TABLE `incarnation` DROP COLUMN `epoch`;