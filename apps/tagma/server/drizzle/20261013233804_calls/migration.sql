CREATE TABLE `listening_follower` (
	`listening_id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`every_ms` integer NOT NULL,
	`through` integer DEFAULT 0 NOT NULL,
	`pending` text,
	`failure` text,
	CONSTRAINT `fk_listening_follower_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `listening_given` (
	`id` integer PRIMARY KEY,
	`listening_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`through` integer NOT NULL,
	`span` text,
	`at` integer NOT NULL,
	CONSTRAINT `fk_listening_given_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `listening_speaker` (
	`listening_id` text NOT NULL,
	`number` integer NOT NULL,
	`track` text NOT NULL,
	`segment` integer NOT NULL,
	`speaker` text NOT NULL,
	`name` text,
	CONSTRAINT `listening_speaker_pk` PRIMARY KEY(`listening_id`, `number`),
	CONSTRAINT `fk_listening_speaker_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `transcript_entry` (
	`id` integer PRIMARY KEY,
	`listening_id` text NOT NULL,
	`key` text NOT NULL,
	CONSTRAINT `fk_transcript_entry_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `transcript_staged` (
	`listening_id` text NOT NULL,
	`seq` integer NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`entry` integer,
	`text` text,
	CONSTRAINT `transcript_staged_pk` PRIMARY KEY(`listening_id`, `seq`),
	CONSTRAINT `fk_transcript_staged_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `listening` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `listening` ADD `gist` text;--> statement-breakpoint
ALTER TABLE `listening` ADD `audio` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `listening` ADD `audio_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `listening` ADD `again` text;--> statement-breakpoint
ALTER TABLE `listening` ADD `indexed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `listening_given_listening_idx` ON `listening_given` (`listening_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `listening_speaker_voice_idx` ON `listening_speaker` (`listening_id`,`track`,`segment`,`speaker`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_entry_key_idx` ON `transcript_entry` (`listening_id`,`key`);--> statement-breakpoint
CREATE VIRTUAL TABLE `transcript_fts` USING fts5(
  `text`,
  content = '',
  contentless_delete = 1,
  tokenize = 'trigram'
);
--> statement-breakpoint
INSERT INTO `listening_speaker` (`listening_id`, `number`, `track`, `segment`, `speaker`)
SELECT `listening_id`, row_number() OVER (PARTITION BY `listening_id` ORDER BY `first`), `track`, `segment`, `speaker`
FROM (
	SELECT
		`transcript_line`.`listening_id` AS `listening_id`,
		json_extract(`transcript_line`.`body`, '$.track') AS `track`,
		CASE WHEN json_extract(`listening`.`recognizer`, '$.speakers') THEN json_extract(`transcript_line`.`body`, '$.segment') ELSE 0 END AS `segment`,
		CASE WHEN json_extract(`listening`.`recognizer`, '$.speakers') THEN coalesce(json_extract(`transcript_line`.`body`, '$.speaker'), '') ELSE '' END AS `speaker`,
		min(`transcript_line`.`change`) AS `first`
	FROM `transcript_line` JOIN `listening` ON `listening`.`id` = `transcript_line`.`listening_id`
	WHERE `transcript_line`.`kind` = 'utterance'
		AND NOT EXISTS (
			SELECT 1 FROM json_each(`listening`.`tracks`) AS `held`
			WHERE json_extract(`held`.`value`, '$.id') = json_extract(`transcript_line`.`body`, '$.track')
				AND json_extract(`held`.`value`, '$.source') = 'mic'
		)
	GROUP BY 1, 2, 3, 4
);
--> statement-breakpoint
UPDATE `transcript_line` SET `body` = json_set(
	`body`,
	'$.speaker',
	(
		SELECT `listening_speaker`.`number`
		FROM `listening_speaker` JOIN `listening` ON `listening`.`id` = `listening_speaker`.`listening_id`
		WHERE `listening_speaker`.`listening_id` = `transcript_line`.`listening_id`
			AND `listening_speaker`.`track` = json_extract(`transcript_line`.`body`, '$.track')
			AND `listening_speaker`.`segment` = CASE WHEN json_extract(`listening`.`recognizer`, '$.speakers') THEN json_extract(`transcript_line`.`body`, '$.segment') ELSE 0 END
			AND `listening_speaker`.`speaker` = CASE WHEN json_extract(`listening`.`recognizer`, '$.speakers') THEN coalesce(json_extract(`transcript_line`.`body`, '$.speaker'), '') ELSE '' END
	),
	'$.units',
	(SELECT json_group_array(json_remove(`unit`.`value`, '$.speaker') ORDER BY `unit`.`key`) FROM json_each(`transcript_line`.`body`, '$.units') AS `unit`)
)
WHERE `kind` = 'utterance';