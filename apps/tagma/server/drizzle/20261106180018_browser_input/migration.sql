ALTER TABLE `browser_profile` ADD `input` text DEFAULT 'human' NOT NULL;
--> statement-breakpoint
UPDATE `browser_profile` SET `input` = 'fast' WHERE `id` IN ('agent', 'managed-agent');