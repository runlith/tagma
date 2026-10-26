CREATE TABLE `adapter_instance` (
	`id` text PRIMARY KEY,
	`adapter` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `adapter_instance_adapter_idx` ON `adapter_instance` (`adapter`,`created_at`);