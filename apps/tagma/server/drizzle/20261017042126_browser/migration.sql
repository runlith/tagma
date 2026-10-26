CREATE TABLE `browser_page` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`profile` text NOT NULL,
	`context` text,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`favicon` text,
	`opened_by` text,
	`opener` text,
	`history` text,
	`downloads` text NOT NULL,
	`active_at` integer NOT NULL,
	`closed_at` integer,
	CONSTRAINT `fk_browser_page_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_browser_page_profile_browser_profile_id_fk` FOREIGN KEY (`profile`) REFERENCES `browser_profile`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `browser_profile` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`document` text NOT NULL,
	`console` text NOT NULL,
	`removal` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `browser_page_project_idx` ON `browser_page` (`project_id`,`closed_at`,`active_at`,`id`);--> statement-breakpoint
CREATE INDEX `browser_page_profile_idx` ON `browser_page` (`profile`);