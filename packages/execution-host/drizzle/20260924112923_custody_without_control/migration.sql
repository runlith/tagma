ALTER TABLE `custody` DROP COLUMN `controller_principal`;--> statement-breakpoint
ALTER TABLE `custody` DROP COLUMN `controller_binding`;--> statement-breakpoint
ALTER TABLE `custody` DROP COLUMN `controller_generation`;--> statement-breakpoint
ALTER TABLE `custody` DROP COLUMN `generation`;--> statement-breakpoint
UPDATE `operation` SET `kind` = 'custody' WHERE `kind` = 'control';