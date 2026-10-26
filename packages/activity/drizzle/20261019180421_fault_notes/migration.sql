CREATE TABLE `mark` (
	`name` text PRIMARY KEY,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `note_fault` ON `note` (`at`) WHERE json_extract(body, '$.type') in ('defect', 'degraded');