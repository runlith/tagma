ALTER TABLE `native_thread` ADD `pending_model` text;--> statement-breakpoint
CREATE INDEX `native_thread_pick_idx` ON `native_thread` (`id`) WHERE "native_thread"."pending_model" is not null;
