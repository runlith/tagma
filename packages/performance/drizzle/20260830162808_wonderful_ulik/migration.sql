CREATE TABLE `performance_group` (
	`key` text PRIMARY KEY,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`closed` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `performance_meta` (
	`key` text PRIMARY KEY,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `performance_record` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`instance_id` text NOT NULL,
	`wall_time` integer NOT NULL,
	`monotonic_start` real NOT NULL,
	`monotonic_end` real NOT NULL,
	`trace_id` text,
	`parent_id` text,
	`name` text,
	`retention_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `fk_performance_record_retention_key_performance_group_key_fk` FOREIGN KEY (`retention_key`) REFERENCES `performance_group`(`key`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `performance_group_retention_idx` ON `performance_group` (`closed`,`ended_at`,`key`);--> statement-breakpoint
CREATE INDEX `performance_record_page_idx` ON `performance_record` (`wall_time`,`id`);--> statement-breakpoint
CREATE INDEX `performance_record_kind_page_idx` ON `performance_record` (`kind`,`wall_time`,`id`);--> statement-breakpoint
CREATE INDEX `performance_record_trace_idx` ON `performance_record` (`trace_id`,`monotonic_start`);--> statement-breakpoint
CREATE INDEX `performance_record_name_idx` ON `performance_record` (`name`,`wall_time`);--> statement-breakpoint
CREATE INDEX `performance_record_group_idx` ON `performance_record` (`retention_key`);