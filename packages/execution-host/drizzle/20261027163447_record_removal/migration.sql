CREATE TABLE `record_removal` (
	`execution_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	`ledgered` integer
);
--> statement-breakpoint
CREATE INDEX `record_removal_incarnation_idx` ON `record_removal` (`incarnation`);