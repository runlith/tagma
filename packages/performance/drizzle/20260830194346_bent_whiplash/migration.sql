DROP INDEX IF EXISTS `performance_record_page_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `performance_record_kind_page_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `performance_record_name_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `performance_record_trace_idx`;--> statement-breakpoint
CREATE INDEX `performance_record_time_idx` ON `performance_record` (`wall_time`,`id`);--> statement-breakpoint
CREATE INDEX `performance_record_kind_name_time_idx` ON `performance_record` (`kind`,`name`,`wall_time`,`id`);--> statement-breakpoint
CREATE INDEX `performance_record_trace_idx` ON `performance_record` (`trace_id`,`instance_id`,`monotonic_start`,`id`);--> statement-breakpoint
CREATE INDEX `performance_record_overlap_idx` ON `performance_record` (`instance_id`,`kind`,`monotonic_start`,`monotonic_end`,`id`);
