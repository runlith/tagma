DROP INDEX `performance_group_retention_idx`;--> statement-breakpoint
ALTER TABLE `performance_group` DROP COLUMN `closed`;--> statement-breakpoint
CREATE INDEX `performance_group_retention_idx` ON `performance_group` (`ended_at`,`key`);
