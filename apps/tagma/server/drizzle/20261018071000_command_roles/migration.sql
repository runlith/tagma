ALTER TABLE `command_window` ADD `role` text DEFAULT '{"kind":"writer"}' NOT NULL;--> statement-breakpoint
ALTER TABLE `command_window` ADD `signatures` text DEFAULT '[]' NOT NULL;