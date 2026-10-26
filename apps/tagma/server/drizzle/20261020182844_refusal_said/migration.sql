ALTER TABLE `rule_refusal` ADD `said` text;--> statement-breakpoint
UPDATE `rule_refusal` SET `said` = `reached`, `reached` = NULL WHERE `fix` IS NOT NULL;
