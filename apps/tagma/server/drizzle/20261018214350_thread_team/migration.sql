ALTER TABLE `thread_mandate` ADD `team` text;
--> statement-breakpoint
DELETE FROM `setting` WHERE `key` = 'agent.modelGuidance';
