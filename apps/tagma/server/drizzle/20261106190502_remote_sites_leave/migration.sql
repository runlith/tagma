CREATE TABLE `remote_terminal` (
	`port` integer PRIMARY KEY
);
--> statement-breakpoint
INSERT INTO `remote_terminal` (`port`) SELECT `port` FROM `remote_site` WHERE `name` = ':terminal';
--> statement-breakpoint
DROP TABLE `remote_site`;