CREATE TABLE `call` (
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`execution_id` text,
	`budget` text NOT NULL,
	`started` text,
	`sources` text,
	`retention` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `call_pk` PRIMARY KEY(`installation`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `call_decision` (
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`decision` text NOT NULL,
	`decided_at` integer NOT NULL,
	CONSTRAINT `call_decision_pk` PRIMARY KEY(`installation`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `custody` (
	`execution_id` text PRIMARY KEY,
	`revision` integer NOT NULL,
	`holder` text NOT NULL,
	`controller_principal` text,
	`controller_binding` text,
	`controller_generation` integer,
	`generation` integer NOT NULL,
	`origin` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_custody_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE TABLE `execution` (
	`execution_id` text PRIMARY KEY,
	`installation` text NOT NULL,
	`incarnation` integer NOT NULL,
	`transport` text NOT NULL,
	`lifetime` text NOT NULL,
	`purpose` text NOT NULL,
	`phase` text NOT NULL,
	`native_exit` text,
	`stdout` text NOT NULL,
	`stderr` text NOT NULL,
	`pty` text NOT NULL,
	`cleanup` text NOT NULL,
	`record_availability` text NOT NULL,
	`target_environment` text NOT NULL,
	`target_namespace` text NOT NULL,
	`target_cwd` text NOT NULL,
	`pid` integer,
	`tty` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_execution_incarnation_incarnation_incarnation_fk` FOREIGN KEY (`incarnation`) REFERENCES `incarnation`(`incarnation`)
);
--> statement-breakpoint
CREATE TABLE `execution_dependency` (
	`execution_id` text NOT NULL,
	`position` integer NOT NULL,
	`receipt` text NOT NULL,
	CONSTRAINT `execution_dependency_pk` PRIMARY KEY(`execution_id`, `position`),
	CONSTRAINT `fk_execution_dependency_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE TABLE `final_facts` (
	`execution_id` text PRIMARY KEY,
	`installation` text NOT NULL,
	`incarnation` integer NOT NULL,
	`native_exit` text,
	`sources` text NOT NULL,
	`cleanup` text NOT NULL,
	`retention` text NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT `fk_final_facts_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE TABLE `incarnation` (
	`incarnation` integer PRIMARY KEY,
	`installation` text NOT NULL,
	`registration` text NOT NULL,
	`phase` text NOT NULL,
	`epoch` integer NOT NULL,
	`current` integer NOT NULL,
	`entered_at` integer NOT NULL,
	`retired_at` integer
);
--> statement-breakpoint
CREATE TABLE `operation` (
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`execution_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `operation_pk` PRIMARY KEY(`installation`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `stop_intent` (
	`execution_id` text PRIMARY KEY,
	`installation` text NOT NULL,
	`operation_id` text NOT NULL,
	`incarnation` integer NOT NULL,
	`cause` text NOT NULL,
	`policy` text NOT NULL,
	`coverage` text NOT NULL,
	`requested_at` integer NOT NULL,
	CONSTRAINT `fk_stop_intent_execution_id_execution_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `execution`(`execution_id`)
);
--> statement-breakpoint
CREATE INDEX `execution_incarnation_idx` ON `execution` (`incarnation`);--> statement-breakpoint
CREATE INDEX `execution_phase_idx` ON `execution` (`phase`);--> statement-breakpoint
CREATE UNIQUE INDEX `incarnation_current_unique` ON `incarnation` (`current`) WHERE "incarnation"."current" = 1;--> statement-breakpoint
CREATE INDEX `operation_execution_idx` ON `operation` (`execution_id`);