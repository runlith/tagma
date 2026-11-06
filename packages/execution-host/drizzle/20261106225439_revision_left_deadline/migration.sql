ALTER TABLE `command_revision` ADD `origin` text DEFAULT 'caller' NOT NULL;--> statement-breakpoint
ALTER TABLE `command_revision` ADD `foreground_ms` integer;