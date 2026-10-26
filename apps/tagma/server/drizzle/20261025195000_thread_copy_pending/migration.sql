ALTER TABLE `thread_copy` ADD `pending_at` integer;
--> statement-breakpoint
UPDATE `thread_copy` SET `pending_at` = `entered_at`;
