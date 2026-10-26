CREATE TABLE `execution_departure` (
	`execution_id` text PRIMARY KEY,
	`accepted` text,
	`remainder` blob,
	`ended` integer,
	`parsed` text,
	`descendants` text NOT NULL,
	`echoes` text NOT NULL,
	`lost` text,
	CONSTRAINT `fk_execution_departure_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
