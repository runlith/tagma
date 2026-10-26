CREATE TABLE `account_quota_reading` (
	`provider` text NOT NULL,
	`account` text NOT NULL,
	`enrollment` text NOT NULL,
	`observation` text NOT NULL,
	CONSTRAINT `account_quota_reading_pk` PRIMARY KEY(`provider`, `account`)
);
--> statement-breakpoint
CREATE TABLE `approval_preference` (
	`principal_id` text PRIMARY KEY,
	`approval_mode` text DEFAULT 'trust' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignment_membership` (
	`thread_id` text NOT NULL,
	`root_id` text NOT NULL,
	`provenance` text NOT NULL,
	CONSTRAINT `assignment_membership_pk` PRIMARY KEY(`thread_id`, `root_id`),
	CONSTRAINT `fk_assignment_membership_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_assignment_membership_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE `assignment_selection` (
	`thread_id` text PRIMARY KEY,
	`root_id` text,
	`provenance` text NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `fk_assignment_selection_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_assignment_selection_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE "block" (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`uuid` text NOT NULL,
	`path` text,
	`project_id` integer NOT NULL,
	`parent_id` integer,
	`ord` real NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_block_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE TABLE `block_field` (
	`block_id` integer NOT NULL,
	`tag` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `block_field_pk` PRIMARY KEY(`block_id`, `tag`, `name`, `value`),
	CONSTRAINT `fk_block_field_block_id_block_id_fk` FOREIGN KEY (`block_id`) REFERENCES `block`(`id`)
);
--> statement-breakpoint
CREATE TABLE `block_tag` (
	`block_id` integer NOT NULL,
	`tag` text NOT NULL, `type_id` text,
	CONSTRAINT `block_tag_pk` PRIMARY KEY(`block_id`, `tag`),
	CONSTRAINT `fk_block_tag_block_id_block_id_fk` FOREIGN KEY (`block_id`) REFERENCES `block`(`id`)
);
--> statement-breakpoint
CREATE TABLE "change_debt" (
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`commit` text NOT NULL,
	`before` text,
	`after` text,
	`source` text DEFAULT 'steps' NOT NULL,
	`reason` text NOT NULL,
	`windows` text DEFAULT '[]' NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `change_debt_pk` PRIMARY KEY(`checkout`, `path`, `commit`, `source`)
);
--> statement-breakpoint
CREATE TABLE "change_landing" (
	`checkout` text NOT NULL,
	`commit` text NOT NULL,
	`tree` text NOT NULL,
	CONSTRAINT `change_landing_pk` PRIMARY KEY(`checkout`, `commit`)
);
--> statement-breakpoint
CREATE TABLE "checkout_seen" (
	`checkout` text PRIMARY KEY,
	`head` text
);
--> statement-breakpoint
CREATE TABLE `command` (
	`execution_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	`project_id` integer NOT NULL,
	`owner` text NOT NULL,
	`owner_thread` text,
	`service_scope` text,
	`created_by` text NOT NULL,
	`created_run` text,
	`created_tool_call` text,
	`policy_identity` text NOT NULL,
	`target_key` text NOT NULL,
	`admitted_at` integer NOT NULL, `root_use_id` text REFERENCES root_use(use_id), `environment_use_id` text REFERENCES environment_use(use_id), `program` text, `cwd` text, `label` text, `command_line` text, `time` text, `root_id` text, `ended_reason` text,
	CONSTRAINT `fk_command_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `command_content` (
	`window` text NOT NULL,
	`digest` text NOT NULL,
	CONSTRAINT `command_content_pk` PRIMARY KEY(`window`, `digest`),
	CONSTRAINT `fk_command_content_window_command_window_id_fk` FOREIGN KEY (`window`) REFERENCES `command_window`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_command_content_digest_workspace_change_content_digest_fk` FOREIGN KEY (`digest`) REFERENCES `workspace_change_content`(`digest`)
);
--> statement-breakpoint
CREATE TABLE `command_delivery` (
	`execution_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	`thread_id` text NOT NULL,
	`signal_id` text NOT NULL,
	`text` text,
	`opened_at` integer NOT NULL
, `readers` integer DEFAULT 0 NOT NULL);
--> statement-breakpoint
CREATE TABLE `command_fence` (
	`project_id` integer NOT NULL,
	`owner_key` text NOT NULL,
	`revision` integer NOT NULL,
	`moved_at` integer NOT NULL,
	CONSTRAINT `command_fence_pk` PRIMARY KEY(`project_id`, `owner_key`),
	CONSTRAINT `fk_command_fence_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "command_rule" (
	`id` text PRIMARY KEY,
	`project_id` integer,
	`thread_id` text,
	`position` integer NOT NULL,
	`through` text,
	`program` text,
	`limit_ms` integer NOT NULL,
	`writer` text NOT NULL,
	`written_at` integer NOT NULL,
	`words` text NOT NULL,
	CONSTRAINT `fk_command_rule_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_command_rule_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `command_unattributed` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_command_unattributed_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `command_unowned` (
	`id` text PRIMARY KEY,
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`after` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_wait` (
	`execution_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	`mode` text NOT NULL,
	`revision` integer NOT NULL,
	`moved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_window` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`run_hint` text,
	`checkout` text NOT NULL,
	`spelling` text NOT NULL,
	`head` text,
	`opened_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`window_from` integer,
	`window_to` integer,
	`base` text,
	`moves` text,
	CONSTRAINT `fk_command_window_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "console_key" (
	`provider` text NOT NULL,
	`account` text DEFAULT '' NOT NULL,
	`key_value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `console_key_pk` PRIMARY KEY(`provider`, `account`)
);
--> statement-breakpoint
CREATE TABLE `custody_notice` (
	`project_id` integer NOT NULL,
	`operation_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`requester` text NOT NULL,
	`execution_id` text NOT NULL,
	`incarnation` integer NOT NULL,
	`expected` integer NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`opened_at` integer NOT NULL,
	CONSTRAINT `custody_notice_pk` PRIMARY KEY(`project_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `d4_report` (
	`key` text PRIMARY KEY,
	`value` integer NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `default_account` (
	`principal_id` text NOT NULL,
	`provider` text NOT NULL,
	`account` text,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `default_account_pk` PRIMARY KEY(`principal_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`secret_digest` text NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `edge` (
	`from_id` integer NOT NULL,
	`to_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL, `created_by_session_id` integer REFERENCES session(id),
	PRIMARY KEY(`from_id`, `to_id`, `kind`),
	FOREIGN KEY (`from_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `environment` (
	`environment_id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`namespace_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `environment_use` (
	`use_id` text PRIMARY KEY,
	`environment_id` text NOT NULL,
	`kind` text NOT NULL,
	`namespace_id` text NOT NULL,
	`witness_provider` text NOT NULL,
	`witness_format` text NOT NULL,
	`witness_token` text NOT NULL,
	`consumer_kind` text NOT NULL,
	`consumer_id` text NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`op` text NOT NULL,
	`block_id` integer,
	`payload` text DEFAULT '{}' NOT NULL
, `session_id` integer REFERENCES session(id), `project_id` integer, `call_id` text);
--> statement-breakpoint
CREATE TABLE `external_session` (
	`id` text PRIMARY KEY,
	`facet` text NOT NULL,
	`cli` text GENERATED ALWAYS AS (json_extract(facet, '$.name')) VIRTUAL,
	`session_key` text GENERATED ALWAYS AS (json_extract(facet, '$.sessionKey')) VIRTUAL,
	`updated_at` integer NOT NULL, `lease_owner` text, `lease_beat` integer, `active_at` integer,
	CONSTRAINT `fk_external_session_id_thread_id_fk` FOREIGN KEY (`id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `file_root` (
	`root_id` text PRIMARY KEY,
	`namespace_id` text NOT NULL,
	`path` text NOT NULL,
	`location_revision` integer NOT NULL,
	`witness_provider` text NOT NULL,
	`witness_format` text NOT NULL,
	`witness_token` text NOT NULL,
	`provenance` text NOT NULL,
	`state` text NOT NULL, `repository_id` text, `git_directory` text, `changed_revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_file_root_namespace_id_file_root_namespace_namespace_id_fk` FOREIGN KEY (`namespace_id`) REFERENCES `file_root_namespace`(`namespace_id`)
);
--> statement-breakpoint
CREATE TABLE `file_root_namespace` (
	`namespace_id` text PRIMARY KEY,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `landing_intent` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`project_id` integer NOT NULL,
	`phase` text NOT NULL,
	`repository` text NOT NULL,
	`checkout` text NOT NULL,
	`ref` text NOT NULL,
	`base` text NOT NULL,
	`tree` text NOT NULL,
	`commit` text,
	`witnessed_at` integer,
	`at` integer NOT NULL,
	CONSTRAINT `fk_landing_intent_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `landing_receipt` (
	`key` text PRIMARY KEY,
	`commit` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_landing_receipt_key_landing_intent_key_fk` FOREIGN KEY (`key`) REFERENCES `landing_intent`(`key`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `listening` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`title` text,
	`started_at` integer NOT NULL,
	`end_ms` integer,
	`state` text NOT NULL,
	`handoff` integer DEFAULT false NOT NULL,
	`tracks` text NOT NULL,
	`recognizer` text NOT NULL,
	`changes` integer DEFAULT 0 NOT NULL, `lines` integer DEFAULT 0 NOT NULL, `utterances` integer DEFAULT 0 NOT NULL, `segments` text DEFAULT '{}' NOT NULL, "given_through" integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_listening_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `merge_receipt` (
	`root_id` text NOT NULL,
	`commit` text NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`branch` text NOT NULL,
	`base` text NOT NULL,
	`mode` text NOT NULL,
	`waited_since` integer,
	`after_act` text NOT NULL,
	`after_outcome` text NOT NULL,
	`after_reason` text,
	`addressees` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `merge_receipt_pk` PRIMARY KEY(`root_id`, `commit`),
	CONSTRAINT `fk_merge_receipt_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `merge_request` (
	`key` text PRIMARY KEY,
	`request` text NOT NULL,
	`root_id` text NOT NULL,
	`base_root_id` text NOT NULL,
	`name` text NOT NULL,
	`branch` text NOT NULL,
	`base_branch` text NOT NULL,
	`mode` text NOT NULL,
	`source` text NOT NULL,
	`after` text NOT NULL,
	`end` text,
	`caller` text,
	`waited_since` integer,
	`after_state` text NOT NULL,
	`after_outcome` text,
	`after_reason` text, `source_path` text DEFAULT '' NOT NULL, `source_state` text DEFAULT 'none' NOT NULL, `source_reason` text, `rules_after` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_merge_request_key_landing_intent_key_fk` FOREIGN KEY (`key`) REFERENCES `landing_intent`(`key`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_preference` (
	`principal_id` text PRIMARY KEY,
	`provider` text DEFAULT 'openai-oauth' NOT NULL,
	`model` text,
	`reasoning` text,
	`default_switches` text DEFAULT '{}' NOT NULL,
	`favorite_models` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "native_thread" (
	`id` text PRIMARY KEY,
	`cache_group` text NOT NULL,
	`profile` text,
	`pending_interaction` text,
	`account` text,
	`provider` text DEFAULT 'openai-oauth' NOT NULL,
	`model` text,
	`reasoning` text,
	`switches` text DEFAULT '{}' NOT NULL,
	`transport` text DEFAULT '{"adapter":"native","profile":null,"agent":null}' NOT NULL,
	`capabilities` text DEFAULT '{"messaging":true,"judgedModel":true,"steer":"step","withdraw":true,"history":"journal","compaction":"core","modelMove":"live","openings":"core","pictures":true,"web":"none","law":"every-call","touch":"reads-and-writes","authorship":"recorded","callEnvelopeMs":1200000,"screen":false,"continue":true}' NOT NULL,
	`call_envelope_ms` integer GENERATED ALWAYS AS (json_extract(capabilities, '$.callEnvelopeMs')) VIRTUAL,
	`system_prompt` text,
	`pending_system_prompt` text,
	`failure_reason` text,
	`context_reading` text,
	`context_event_id` integer DEFAULT 0 NOT NULL,
	`world_state_snapshot` text DEFAULT '{}' NOT NULL,
	`world_state_checkpoint_id` text,
	`context_runs` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_native_thread_id_thread_id_fk` FOREIGN KEY (`id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `native_thread_rev` (
	`thread_id` text PRIMARY KEY,
	`fold_rev` integer DEFAULT 0 NOT NULL,
	`inherit_rev` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_native_thread_rev_thread_id_native_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `native_thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY,
	`sender` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`question_text` text,
	`question_options` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	`outcome` text,
	`answer` text,
	`delivered_at` integer
, `key` text);
--> statement-breakpoint
CREATE TABLE `open_terminal` (
	`terminal_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	CONSTRAINT `fk_open_terminal_terminal_id_terminal_execution_id_fk` FOREIGN KEY (`terminal_id`) REFERENCES `terminal`(`execution_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `open_terminal_progress` (
	`cursor` integer NOT NULL,
	`done` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `owed_call` (
	`run_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`name` text NOT NULL,
	`input` text NOT NULL,
	`epoch` text NOT NULL,
	`opened_at` integer NOT NULL,
	`ended_at` integer,
	`outcome` text,
	`words` text,
	CONSTRAINT `owed_call_pk` PRIMARY KEY(`run_id`, `tool_call_id`),
	CONSTRAINT `fk_owed_call_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pairing` (
	`code_digest` text PRIMARY KEY,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prepared_tree` (
	`id` text PRIMARY KEY,
	`project_id` integer,
	`owner_id` text NOT NULL,
	`state` text DEFAULT 'building' NOT NULL,
	`receipt` text NOT NULL,
	`manifest` text,
	`archive_path` text,
	`resources_released` integer DEFAULT false NOT NULL,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `cleanup_reason` text,
	CONSTRAINT `fk_prepared_tree_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "project" (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL UNIQUE,
	`repo_key` text NOT NULL,
	`root_path` text NOT NULL,
	`strict_provenance` integer DEFAULT false NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
, `global` integer DEFAULT false NOT NULL, `storage` text DEFAULT 'stealth' NOT NULL);
--> statement-breakpoint
CREATE TABLE `project_policy` (
	`project_id` integer PRIMARY KEY,
	`strict_provenance` integer DEFAULT false NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`storage` text DEFAULT 'stealth' NOT NULL,
	CONSTRAINT `fk_project_policy_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_root` (
	`project_id` integer NOT NULL,
	`root_id` text NOT NULL,
	`origin` text NOT NULL,
	CONSTRAINT `project_root_pk` PRIMARY KEY(`project_id`, `root_id`),
	CONSTRAINT `fk_project_root_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_root_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE `project_root_cover` (
	`project_id` integer PRIMARY KEY,
	`namespace_id` text NOT NULL,
	`root_path` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_project_root_cover_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `protocol_session` (
	`id` text PRIMARY KEY,
	`row` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_protocol_session_id_thread_id_fk` FOREIGN KEY (`id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `protocol_turn` (
	`thread_id` text NOT NULL,
	`turn` text NOT NULL,
	`ordinal` integer NOT NULL,
	`prompt` text,
	`last` text,
	`cost` text,
	CONSTRAINT `protocol_turn_pk` PRIMARY KEY(`thread_id`, `turn`),
	CONSTRAINT `fk_protocol_turn_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `push_sent` (
	`subscription_id` text NOT NULL,
	"subject" text NOT NULL,
	`event_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	CONSTRAINT `push_sent_pk` PRIMARY KEY(`subscription_id`, "subject", `event_id`)
);
--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY,
	`device_id` text NOT NULL UNIQUE,
	`endpoint` text NOT NULL UNIQUE,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ref` (
	`from_id` integer NOT NULL,
	`to_id` integer NOT NULL,
	PRIMARY KEY(`from_id`, `to_id`),
	FOREIGN KEY (`from_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE "released_line" (
	`row` text PRIMARY KEY,
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`thread` text NOT NULL,
	`reason` text NOT NULL,
	`span` text NOT NULL,
	CONSTRAINT `fk_released_line_row_workspace_change_id_fk` FOREIGN KEY (`row`) REFERENCES `workspace_change`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `remeasure_landing` (
	`key` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`root` text NOT NULL,
	`payload` text NOT NULL,
	`at` integer NOT NULL, `parked` text,
	CONSTRAINT `fk_remeasure_landing_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `remote_origin` (
	`origin` text PRIMARY KEY,
	`settled_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `remote_site` (
	`name` text PRIMARY KEY,
	`port` integer NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "repository" (
	`repository_id` text PRIMARY KEY,
	`namespace_id` text NOT NULL,
	`common_directory` text NOT NULL,
	`location_revision` integer NOT NULL,
	`witness_provider` text NOT NULL,
	`witness_format` text NOT NULL,
	`witness_token` text NOT NULL,
	`project_id` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `root_use` (
	`use_id` text PRIMARY KEY,
	`namespace_id` text NOT NULL,
	`path` text NOT NULL,
	`consumer_kind` text NOT NULL,
	`consumer_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `root_use_hold` (
	`use_id` text NOT NULL,
	`root_id` text NOT NULL,
	`location_revision` integer NOT NULL,
	CONSTRAINT `root_use_hold_pk` PRIMARY KEY(`use_id`, `root_id`),
	CONSTRAINT `fk_root_use_hold_use_id_root_use_use_id_fk` FOREIGN KEY (`use_id`) REFERENCES `root_use`(`use_id`),
	CONSTRAINT `fk_root_use_hold_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE `rule_refusal` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`project_id` integer NOT NULL,
	`rule` text NOT NULL,
	`op` text NOT NULL,
	`file` text NOT NULL,
	`line` integer,
	`fingerprint` text NOT NULL,
	`reached` text,
	`base` text,
	`branch` text,
	`actor` text,
	`at` integer NOT NULL,
	CONSTRAINT `fk_rule_refusal_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "sandbox" (
	`id` text PRIMARY KEY,
	`project_id` integer,
	`owner_id` text NOT NULL,
	`state` text DEFAULT 'preparing' NOT NULL,
	`bound_thread_id` text,
	`runtime` text NOT NULL,
	`manifest` text,
	`failure_reason` text,
	`export_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workspace_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_bound_thread_id_thread_id_fk` FOREIGN KEY (`bound_thread_id`) REFERENCES `thread`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_run` (
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`every_ms` integer NOT NULL,
	`next_at` integer NOT NULL,
	`last_started_at` integer,
	`last_ended_at` integer,
	`last_outcome` text,
	`last_reason` text,
	`last_skipped` integer,
	CONSTRAINT `schedule_run_pk` PRIMARY KEY(`owner`, `name`)
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  `text`,
  content = `search_index`,
  content_rowid = `block_id`,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE TABLE `search_index` (
	`block_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL, `title_text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`harness` text NOT NULL,
	`key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`scope` text NOT NULL,
	`project_id` integer,
	`key` text NOT NULL,
	`value` text,
	`declined` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL, `session_id` integer REFERENCES session(id),
	CONSTRAINT `fk_setting_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`)
);
--> statement-breakpoint
CREATE TABLE "source" (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`block_id` integer NOT NULL,
	`kind` text NOT NULL,
	"ref" text NOT NULL,
	`symbol` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`block_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `spent_call_key` (
	`actor` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`digest` text NOT NULL,
	`spent_at` integer NOT NULL,
	CONSTRAINT `spent_call_key_pk` PRIMARY KEY(`actor`, `operation`, `key`)
);
--> statement-breakpoint
CREATE TABLE `spent_epoch` (
	`id` integer PRIMARY KEY,
	`at` integer NOT NULL,
	CONSTRAINT "spent_epoch_single" CHECK("id" = 1)
);
--> statement-breakpoint
CREATE TABLE `target_snapshot` (
	`thread_id` text NOT NULL,
	`run_id` text NOT NULL,
	`generation` integer NOT NULL,
	`source_key` text NOT NULL,
	`project_id` integer NOT NULL,
	`working_root` text NOT NULL,
	`graph_root` text NOT NULL,
	`place` text,
	`admitted_at` text NOT NULL,
	CONSTRAINT `target_snapshot_pk` PRIMARY KEY(`thread_id`, `run_id`, `generation`),
	CONSTRAINT `fk_target_snapshot_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_target_snapshot_run_id_thread_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `thread_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `terminal` (
	`execution_id` text PRIMARY KEY,
	`incarnation` integer NOT NULL,
	`project_id` integer NOT NULL,
	`transport` text NOT NULL,
	`lifetime` text NOT NULL,
	`target_key` text NOT NULL,
	`holder` text NOT NULL,
	`origin` text NOT NULL,
	`revision` integer NOT NULL,
	`root_use_id` text,
	`environment_use_id` text,
	`held_by_thread` text,
	`quarantine` text,
	`accepted_at` integer NOT NULL, `program` text, `cwd` text, `label` text, `command_line` text, `discharged_at` integer, `root_id` text, `launched_for` text, `shell_key` text, `ended_reason` text,
	CONSTRAINT `fk_terminal_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_terminal_root_use_id_root_use_use_id_fk` FOREIGN KEY (`root_use_id`) REFERENCES `root_use`(`use_id`),
	CONSTRAINT `fk_terminal_environment_use_id_environment_use_use_id_fk` FOREIGN KEY (`environment_use_id`) REFERENCES `environment_use`(`use_id`)
);
--> statement-breakpoint
CREATE TABLE `terminal_intent` (
	`project_id` integer NOT NULL,
	`operation_id` text NOT NULL,
	`phase` text NOT NULL,
	`root_use_id` text,
	`environment_use_id` text,
	`outgoing_thread` text,
	`incoming_thread` text,
	`opened_at` integer NOT NULL, `command_service_scope` text, `command_created_by` text, `command_created_run` text, `command_created_tool_call` text, `command_policy_identity` text, `command_wait_mode` text, `command_program` text, `command_cwd` text, `command_label` text, `command_line` text, `command_time` text, `root_id` text, `launched_for` text, `shell_key` text,
	CONSTRAINT `terminal_intent_pk` PRIMARY KEY(`project_id`, `operation_id`),
	CONSTRAINT `fk_terminal_intent_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_terminal_intent_root_use_id_root_use_use_id_fk` FOREIGN KEY (`root_use_id`) REFERENCES `root_use`(`use_id`),
	CONSTRAINT `fk_terminal_intent_environment_use_id_environment_use_use_id_fk` FOREIGN KEY (`environment_use_id`) REFERENCES `environment_use`(`use_id`),
	CONSTRAINT `fk_terminal_intent_outgoing_thread_thread_id_fk` FOREIGN KEY (`outgoing_thread`) REFERENCES `thread`(`id`),
	CONSTRAINT `fk_terminal_intent_incoming_thread_thread_id_fk` FOREIGN KEY (`incoming_thread`) REFERENCES `thread`(`id`)
);
--> statement-breakpoint
CREATE TABLE "terminal_request_key" (
	`project_id` integer NOT NULL,
	`operation_id` text NOT NULL,
	`requester` text NOT NULL,
	`mutation` text NOT NULL,
	`target_key` text NOT NULL,
	`execution_id` text,
	`incarnation` integer,
	`host_operation` text,
	`outcome` text NOT NULL,
	`uncertain` text,
	`at` integer NOT NULL, `input_outcome` text,
	CONSTRAINT `terminal_operation_pk` PRIMARY KEY(`project_id`, `operation_id`),
	CONSTRAINT `fk_terminal_operation_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "terminal_request_key_tally" (
	`outcome` text PRIMARY KEY,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `terminal_writer` (
	`execution_id` text NOT NULL,
	`incarnation` integer NOT NULL,
	`writer` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `terminal_writer_pk` PRIMARY KEY(`execution_id`, `incarnation`, `writer`),
	CONSTRAINT `fk_terminal_writer_execution_id_terminal_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `terminal`(`execution_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread" (
	`id` text PRIMARY KEY,
	`project_id` integer,
	`origin` text NOT NULL,
	`parent_id` text,
	`spawn_root_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`name` text,
	`title` text DEFAULT 'New thread' NOT NULL,
	`title_origin` text DEFAULT 'random' NOT NULL,
	`title_revision` integer DEFAULT 0 NOT NULL,
	`title_asked_input` text,
	`harness` text DEFAULT 'lode' NOT NULL,
	`agent_id` text NOT NULL,
	`born_of` text,
	`spawned_by_run_id` text,
	`created_by` text,
	`scope_block_uuid` text,
	`created_by_session_id` integer,
	`reader_order_at` integer NOT NULL,
	`pinned_at` integer,
	`archived_at` integer,
	`status` text DEFAULT 'idle' NOT NULL,
	`running_run_id` text,
	`moved_at` integer,
	`created_at` integer NOT NULL, `detached_from` text REFERENCES thread(id) ON DELETE SET NULL, `detached_at` integer, `folder_id` text REFERENCES thread_folder(id) ON DELETE SET NULL, `recap` text,
	CONSTRAINT `fk_thread_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_parent_id_thread_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_created_by_session_id_session_id_fk` FOREIGN KEY (`created_by_session_id`) REFERENCES `session`(`id`),
	CONSTRAINT "thread_origin" CHECK(("origin" = 'unscoped') = ("project_id" is null))
);
--> statement-breakpoint
CREATE TABLE `thread_cache_observation` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`thread_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`sent_at` text NOT NULL,
	`gap_ms` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	CONSTRAINT `fk_thread_cache_observation_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_call` (
	`actor` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`thread_id` text NOT NULL,
	`digest` text NOT NULL,
	`result` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `thread_call_pk` PRIMARY KEY(`actor`, `operation`, `key`),
	CONSTRAINT `fk_thread_call_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_compaction_checkpoint" (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`source_run_id` text,
	`covered_message_count` integer NOT NULL,
	`covered_prefix_hash` text NOT NULL,
	`summary` text NOT NULL,
	`usage` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `thread_compaction_checkpoint_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_conversation` (
	`thread_id` text PRIMARY KEY,
	`through` integer DEFAULT 0 NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`unreadable` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_thread_conversation_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_entry" (
	`thread_id` text NOT NULL,
	`ord` integer NOT NULL,
	`entry_id` text NOT NULL,
	`run_id` text,
	`type` text NOT NULL,
	`entry` text NOT NULL,
	CONSTRAINT `thread_entry_pk` PRIMARY KEY(`thread_id`, `ord`),
	CONSTRAINT `fk_thread_entry_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_event" (
	"thread_id" text NOT NULL,
	`position` integer NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY("thread_id", `position`),
	FOREIGN KEY ("thread_id") REFERENCES "thread"(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_folder` (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL, `parent_id` text REFERENCES thread_folder(id) ON DELETE CASCADE,
	CONSTRAINT `fk_thread_folder_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_history_item` (
	`thread_id` text NOT NULL,
	`ord` integer NOT NULL,
	`message` text NOT NULL,
	CONSTRAINT `thread_history_item_pk` PRIMARY KEY(`thread_id`, `ord`),
	CONSTRAINT `fk_thread_history_item_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`sender` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`delivered_to_run_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL, `claim_id` text, `closed_at` integer, `closed_by` text, `request_digest` text, `seq` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_inbox_wake` (
	`item_id` text PRIMARY KEY,
	`at` integer NOT NULL,
	CONSTRAINT `fk_thread_inbox_wake_item_id_thread_inbox_id_fk` FOREIGN KEY (`item_id`) REFERENCES `thread_inbox`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_live_spell" (
	`thread_id` text PRIMARY KEY,
	`started_at` integer NOT NULL,
	CONSTRAINT `fk_lode_thread_live_spell_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_log" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"history_through" integer DEFAULT 0 NOT NULL, `entries_through` integer DEFAULT 0 NOT NULL, `stripped_through` integer DEFAULT 0 NOT NULL, `bounded_through` integer, `footprints_through` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY ("thread_id") REFERENCES "thread"(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_mandate` (
	`id` text PRIMARY KEY,
	`authority` text NOT NULL,
	`delegation` integer,
	`budget_tokens` integer,
	`host_kind` text,
	`host_id` text, `operator_notice` integer, `bindings` text DEFAULT '{}' NOT NULL, `approves` text, `taken_over` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_thread_mandate_id_thread_id_fk` FOREIGN KEY (`id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_message` (
	`key` integer PRIMARY KEY,
	`thread_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`position` integer NOT NULL,
	`appeared` integer NOT NULL,
	`run_id` text,
	`role` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`rewound` text,
	`text` text NOT NULL,
	CONSTRAINT `fk_thread_message_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `thread_message_fts` USING fts5(
  `text`,
  content = '',
  contentless_delete = 1,
  tokenize = 'trigram'
);
--> statement-breakpoint
CREATE TABLE `thread_message_gap` (
	`thread_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`run_id` text,
	CONSTRAINT `thread_message_gap_pk` PRIMARY KEY(`thread_id`, `entry_id`),
	CONSTRAINT `fk_thread_message_gap_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_pruned_tool_call` (
	`thread_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`created_at` integer NOT NULL, `tokens` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`thread_id`, `tool_call_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `thread_quiet_run` (
	`thread_id` text NOT NULL,
	`run_id` text NOT NULL,
	CONSTRAINT `thread_quiet_run_pk` PRIMARY KEY(`thread_id`, `run_id`),
	CONSTRAINT `fk_thread_quiet_run_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_resource" (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`thread_id` text,
	`held_at` integer NOT NULL,
	CONSTRAINT `thread_resource_pk` PRIMARY KEY(`kind`, `id`),
	CONSTRAINT `fk_thread_resource_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `thread_rollout_cursor` (
	`thread_id` text PRIMARY KEY,
	`next_byte_offset` integer DEFAULT 0 NOT NULL,
	`next_position` integer DEFAULT 1 NOT NULL, `generation` integer DEFAULT 0 NOT NULL, `rested_at` integer,
	CONSTRAINT `fk_thread_rollout_cursor_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_rollout_form` (
	`thread_id` text PRIMARY KEY,
	`formed_at` integer NOT NULL, `refusal` text, `publishing` text,
	CONSTRAINT `fk_thread_rollout_form_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_rollout_home` (
	`path` text PRIMARY KEY,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_rollout_refusal` (
	`thread_id` text PRIMARY KEY,
	`reason` text NOT NULL,
	`message` text NOT NULL,
	`next_byte_offset` integer NOT NULL,
	`next_position` integer NOT NULL,
	`seen_at` integer NOT NULL,
	CONSTRAINT `fk_thread_rollout_refusal_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_run" (
	`id` text PRIMARY KEY,
	`thread_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`owner_id` text NOT NULL,
	`provider` text,
	`model` text,
	`reasoning` text,
	`switches` text DEFAULT '{}' NOT NULL,
	`approval_mode` text DEFAULT 'trust' NOT NULL,
	`interactive` integer DEFAULT false NOT NULL,
	`progress` text DEFAULT '{"stage":null,"message":null}' NOT NULL,
	`usage` text,
	`stream_tail` text,
	`resumes` integer DEFAULT 0 NOT NULL,
	`failure_reason` text,
	`failure` text,
	`created_at` integer NOT NULL,
	`started_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL,
	`finished_at` integer,
	`settled_notified_at` integer,
	`settled_notify_attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL, `handed_over_at` integer, `account` text, `settled_by` text, `settled_notification` text, `applied_seq` integer DEFAULT 0 NOT NULL, `start_key` text, `start_digest` text, `end_digest` text, `end_result` text, `stop_request` text, `kind` text DEFAULT 'turn' NOT NULL, `origin` text DEFAULT 'core' NOT NULL,
	CONSTRAINT `thread_run_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_run_tally` (
	`thread_id` text PRIMARY KEY,
	`ended_runs` integer DEFAULT 0 NOT NULL,
	`latest_run_id` text NOT NULL,
	`latest_finished_at` integer NOT NULL, `unseen` integer DEFAULT true NOT NULL,
	CONSTRAINT `fk_thread_run_tally_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_run_transition` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`request_digest` text NOT NULL,
	`plan_digest` text NOT NULL,
	`result` text NOT NULL,
	CONSTRAINT `thread_run_transition_pk` PRIMARY KEY(`run_id`, `seq`),
	CONSTRAINT `fk_thread_run_transition_run_id_thread_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `thread_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "thread_seen" (
	`thread_id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	CONSTRAINT `fk_lode_thread_seen_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_target_operation` (
	`thread_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`project_id` integer NOT NULL,
	`payload_digest` text NOT NULL,
	`root_id` text NOT NULL,
	`location_revision` integer NOT NULL,
	`expected_selection_revision` integer,
	`selection_revision` integer NOT NULL,
	`expected_generation` integer,
	`from_generation` integer,
	`creation_operation_id` text,
	`run_id` text,
	`status` text NOT NULL,
	`generation` integer,
	`detail` text,
	CONSTRAINT `thread_target_operation_pk` PRIMARY KEY(`thread_id`, `operation_key`),
	CONSTRAINT `fk_thread_target_operation_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `thread_view_pin` (
	`thread_id` text NOT NULL,
	`plugin` text NOT NULL,
	`view` text NOT NULL,
	`key` text NOT NULL,
	CONSTRAINT `thread_view_pin_pk` PRIMARY KEY(`thread_id`, `plugin`, `view`, `key`),
	CONSTRAINT `fk_thread_view_pin_thread_id_thread_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `thread`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `touch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`place` text NOT NULL,
	`wrote` integer DEFAULT false NOT NULL,
	`touched_at` integer NOT NULL, `session_id` integer REFERENCES session(id),
	FOREIGN KEY (`task_id`) REFERENCES `block`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transcript_line` (
	`listening_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`change` integer NOT NULL,
	`body` text NOT NULL,
	CONSTRAINT `transcript_line_pk` PRIMARY KEY(`listening_id`, `key`),
	CONSTRAINT `fk_transcript_line_listening_id_listening_id_fk` FOREIGN KEY (`listening_id`) REFERENCES `listening`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workflow_run` (
	`id` text PRIMARY KEY,
	`workflow` text NOT NULL,
	`project_id` integer NOT NULL,
	`plan` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`records` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL, `thread` text NOT NULL, `lease` text, `input` text NOT NULL,
	CONSTRAINT `fk_workflow_run_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "workspace_change" (
	`id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	"holder" text NOT NULL,
	`run_id` text,
	`checkout` text NOT NULL,
	`path` text NOT NULL,
	`moved_from` text,
	`head` text,
	`state` text NOT NULL,
	`reason` text,
	`origin` text NOT NULL,
	`mode` text,
	`first_line` integer,
	`lines` integer,
	`old_lines` integer,
	`window_before` integer,
	`reverts` text,
	`before_hash` text,
	`after_hash` text,
	`old_text` text,
	`new_text` text,
	`added` integer,
	`removed` integer,
	`at` integer NOT NULL,
	`committed_at` integer,
	`commit` text,
	`withdrawn_at` integer,
	`commit_call` text,
	`record_key` text,
	CONSTRAINT `fk_workspace_change_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_change_content` (
	`digest` text PRIMARY KEY,
	`text` text NOT NULL,
	`bytes` integer NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_change_released` (
	`digest` text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE `worktree` (
	`root_id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`branch` text,
	`base_branch` text,
	`base_commit` text NOT NULL,
	`hue` integer NOT NULL,
	`origin` text NOT NULL,
	`setup` text NOT NULL,
	`archived_at` integer,
	`task_id` text,
	`created_at` integer NOT NULL, `setup_detail` text, `named_by` text,
	CONSTRAINT `fk_worktree_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE `worktree_archive_intent` (
	`key` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`root_id` text NOT NULL,
	`phase` text NOT NULL,
	`paths` text NOT NULL,
	`holders` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worktree_operation` (
	`operation_id` text PRIMARY KEY,
	`namespace_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`repository_revision` integer NOT NULL,
	`destination` text NOT NULL,
	`mode` text NOT NULL,
	`branch` text,
	`start` text,
	`base` text NOT NULL,
	`payload_digest` text NOT NULL,
	`status` text NOT NULL,
	`reserved` integer NOT NULL,
	`root_id` text,
	`evidence` text,
	`revision` integer NOT NULL, `abandonment` text, `producer` text,
	CONSTRAINT `fk_worktree_operation_root_id_file_root_root_id_fk` FOREIGN KEY (`root_id`) REFERENCES `file_root`(`root_id`)
);
--> statement-breakpoint
CREATE TABLE `worktree_pending_merge` (
	`root_id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`mode` text NOT NULL,
	`message` text,
	`after` text NOT NULL,
	`state` text NOT NULL,
	`queued_at` integer NOT NULL,
	`attempts` integer NOT NULL,
	`refusal` text
, `end_running` text, `caller` text);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('threads', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('lode_threads', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('external', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('created_at_differs', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('unscoped', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('sessions_built', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('runs_cut', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('native_selection', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('legacy_failure', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('records', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('native_rows', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('external_sessions', 0, NULL);
--> statement-breakpoint
INSERT INTO "d4_report" ("key", "value", "detail") VALUES ('rested', 0, NULL);
--> statement-breakpoint
INSERT INTO "meta" ("key", "value") VALUES ('type-index-pending', '1');
--> statement-breakpoint
INSERT INTO "spent_epoch" ("id", "at") VALUES (1, strftime('%s', 'now') * 1000);
--> statement-breakpoint
INSERT INTO "terminal_request_key_tally" ("outcome", "count") VALUES ('pending', 0);
--> statement-breakpoint
INSERT INTO "terminal_request_key_tally" ("outcome", "count") VALUES ('admitted', 0);
--> statement-breakpoint
INSERT INTO "terminal_request_key_tally" ("outcome", "count") VALUES ('settled', 0);
--> statement-breakpoint
INSERT INTO "terminal_request_key_tally" ("outcome", "count") VALUES ('uncertain', 0);
--> statement-breakpoint
INSERT INTO "terminal_request_key_tally" ("outcome", "count") VALUES ('expired', 0);
--> statement-breakpoint
CREATE INDEX `assignment_membership_root_idx` ON `assignment_membership` (`root_id`);
--> statement-breakpoint
CREATE INDEX `block_field_seek_idx` ON `block_field` (`tag`,`name`,`value`,`block_id`);
--> statement-breakpoint
CREATE INDEX `block_name_idx` ON `block` (substr(replace(`uuid`, '-', ''), -8));
--> statement-breakpoint
CREATE INDEX `block_parent_idx` ON `block` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `block_project_idx` ON `block` (`project_id`);
--> statement-breakpoint
CREATE INDEX `block_tag_tag_idx` ON `block_tag` (`tag`,`block_id`);
--> statement-breakpoint
CREATE INDEX `block_tag_type_idx` ON `block_tag` (`type_id`,`block_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `block_uuid_idx` ON `block` (`uuid`);
--> statement-breakpoint
CREATE INDEX `command_content_digest_idx` ON `command_content` (`digest`);
--> statement-breakpoint
CREATE INDEX `command_delivery_page_idx` ON `command_delivery` (`opened_at`,`execution_id`);
--> statement-breakpoint
CREATE INDEX `command_generation_owner_idx` ON `command` (`incarnation`,`owner_thread`);
--> statement-breakpoint
CREATE INDEX `command_owner_idx` ON `command` (`project_id`,`owner_thread`);
--> statement-breakpoint
CREATE INDEX `command_page_idx` ON `command` (`project_id`,`admitted_at`,`execution_id`);
--> statement-breakpoint
CREATE INDEX `command_project_idx` ON `command` (`project_id`);
--> statement-breakpoint
CREATE INDEX `command_rule_list_idx` ON `command_rule` (`project_id`,`thread_id`,`position`);
--> statement-breakpoint
CREATE INDEX `command_rule_thread_idx` ON `command_rule` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `command_thread_idx` ON `command` (`owner_thread`);
--> statement-breakpoint
CREATE INDEX `command_unattributed_thread_idx` ON `command_unattributed` (`project_id`,`thread_id`,`at`);
--> statement-breakpoint
CREATE INDEX `command_unowned_at_idx` ON `command_unowned` (`at`);
--> statement-breakpoint
CREATE INDEX `command_window_opened_idx` ON `command_window` (`opened_at`);
--> statement-breakpoint
CREATE INDEX `custody_notice_page_idx` ON `custody_notice` (`opened_at`);
--> statement-breakpoint
CREATE INDEX `device_paired_idx` ON `device` (`paired_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `edge_one_successor_idx` ON `edge` (`to_id`) WHERE "edge"."kind" = 'supersedes';
--> statement-breakpoint
CREATE INDEX `edge_to_idx` ON `edge` (`to_id`,`kind`);
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_host_idx` ON `environment` (`kind`) WHERE "environment"."kind" = 'host';
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_namespace_idx` ON `environment` (`namespace_id`);
--> statement-breakpoint
CREATE INDEX `environment_use_consumer_idx` ON `environment_use` (`consumer_kind`,`consumer_id`) WHERE "environment_use"."outcome" <> 'released';
--> statement-breakpoint
CREATE INDEX `environment_use_standing_idx` ON `environment_use` (`environment_id`,`consumer_kind`,`consumer_id`) WHERE "environment_use"."outcome" <> 'released';
--> statement-breakpoint
CREATE INDEX `event_block_idx` ON `event` (`block_id`);
--> statement-breakpoint
CREATE INDEX `event_call_idx` ON `event` (`call_id`);
--> statement-breakpoint
CREATE INDEX `event_project_idx` ON `event` (`project_id`,`id`);
--> statement-breakpoint
CREATE INDEX `event_project_op_idx` ON `event` (`project_id`,`op`);
--> statement-breakpoint
CREATE INDEX `event_project_session_idx` ON `event` (`project_id`,`session_id`);
--> statement-breakpoint
CREATE INDEX `external_session_key_idx` ON `external_session` (`cli`,`session_key`);
--> statement-breakpoint
CREATE INDEX `external_session_lease_idx` ON `external_session` (`lease_owner`,`lease_beat`) WHERE "external_session"."lease_beat" is not null;
--> statement-breakpoint
CREATE INDEX `external_session_recover_idx` ON `external_session` (`id`) WHERE json_type("external_session"."facet", '$.session') = 'object' and json_extract("external_session"."facet", '$.session.state') is not 'ended';
--> statement-breakpoint
CREATE INDEX `file_root_changes_idx` ON `file_root` (`namespace_id`,`changed_revision`,`root_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_root_identity_idx` ON `file_root` (`namespace_id`,`witness_provider`,`witness_format`,`witness_token`) WHERE "file_root"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `file_root_location_idx` ON `file_root` (`namespace_id`,`path`) WHERE "file_root"."state" = 'active';
--> statement-breakpoint
CREATE INDEX `file_root_namespace_idx` ON `file_root` (`namespace_id`,`state`,`root_id`);
--> statement-breakpoint
CREATE INDEX `file_root_repository_idx` ON `file_root` (`namespace_id`,`state`,`repository_id`);
--> statement-breakpoint
CREATE INDEX `file_root_witness_idx` ON `file_root` (`namespace_id`,`witness_provider`,`witness_format`,`witness_token`);
--> statement-breakpoint
CREATE INDEX `landing_intent_ended_idx` ON `landing_intent` (`kind`,`at`) WHERE "landing_intent"."phase" in ('settled', 'lost');
--> statement-breakpoint
CREATE INDEX `landing_intent_open_idx` ON `landing_intent` (`kind`,`at`,`key`) WHERE "landing_intent"."phase" in ('intended', 'publishing', 'published');
--> statement-breakpoint
CREATE INDEX `listening_project_idx` ON `listening` (`project_id`,`started_at`,`id`);
--> statement-breakpoint
CREATE INDEX `merge_receipt_project_idx` ON `merge_receipt` (`project_id`);
--> statement-breakpoint
CREATE INDEX `native_thread_asking_idx` ON `native_thread` (`id`) WHERE json_extract("native_thread"."pending_interaction", '$.action') is not null;
--> statement-breakpoint
CREATE INDEX `native_thread_updated_idx` ON `native_thread` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `notification_ended_idx` ON `notification` (`ended_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_key_idx` ON `notification` (`sender`,`key`);
--> statement-breakpoint
CREATE INDEX `notification_sender_idx` ON `notification` (`sender`);
--> statement-breakpoint
CREATE INDEX `open_terminal_incarnation_idx` ON `open_terminal` (`incarnation`);
--> statement-breakpoint
CREATE INDEX `owed_call_opened_idx` ON `owed_call` (`opened_at`,`run_id`,`tool_call_id`);
--> statement-breakpoint
CREATE INDEX `owed_call_thread_idx` ON `owed_call` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `prepared_tree_project_idx` ON `prepared_tree` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `prepared_tree_state_idx` ON `prepared_tree` (`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_identity_idx` ON `project` (`repo_key`);
--> statement-breakpoint
CREATE INDEX `project_root_root_idx` ON `project_root` (`root_id`);
--> statement-breakpoint
CREATE INDEX `protocol_turn_order` ON `protocol_turn` (`thread_id`,`ordinal`);
--> statement-breakpoint
CREATE INDEX `push_sent_at_idx` ON `push_sent` (`sent_at`);
--> statement-breakpoint
CREATE INDEX `ref_to_idx` ON `ref` (`to_id`);
--> statement-breakpoint
CREATE INDEX `released_line_path_idx` ON `released_line` (`checkout`,`path`);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_identity_idx` ON `repository` (`namespace_id`,`witness_provider`,`witness_format`,`witness_token`) WHERE "repository"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_location_idx` ON `repository` (`namespace_id`,`common_directory`) WHERE "repository"."state" = 'active';
--> statement-breakpoint
CREATE INDEX `repository_namespace_idx` ON `repository` (`namespace_id`,`state`,`repository_id`);
--> statement-breakpoint
CREATE INDEX `root_use_hold_root_idx` ON `root_use_hold` (`root_id`);
--> statement-breakpoint
CREATE INDEX `root_use_standing_idx` ON `root_use` (`mode`,`use_id`) WHERE "root_use"."state" = 'held';
--> statement-breakpoint
CREATE INDEX `rule_refusal_project_at_idx` ON `rule_refusal` (`project_id`,`at`);
--> statement-breakpoint
CREATE INDEX `rule_refusal_rule_at_idx` ON `rule_refusal` (`project_id`,`rule`,`at`);
--> statement-breakpoint
CREATE INDEX `sandbox_project_idx` ON `sandbox` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `sandbox_state_idx` ON `sandbox` (`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_thread_unique` ON `sandbox` (`bound_thread_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_identity_idx` ON `session` (`harness`,`key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `setting_identity_idx` ON `setting` (`scope`,`key`,case when "project_id" is null then 0 else "project_id" end);
--> statement-breakpoint
CREATE INDEX `source_block_idx` ON `source` (`block_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_identity_idx` ON `source` (`block_id`,`kind`,`ref`,case when "symbol" is null then '' else "symbol" end);
--> statement-breakpoint
CREATE INDEX `source_kind_idx` ON `source` (`kind`);
--> statement-breakpoint
CREATE INDEX `source_place_idx` ON `source` (`ref`,`kind`,`symbol`,`block_id`);
--> statement-breakpoint
CREATE INDEX `target_snapshot_thread_idx` ON `target_snapshot` (`thread_id`,`run_id`);
--> statement-breakpoint
CREATE INDEX `terminal_intent_incoming_idx` ON `terminal_intent` (`incoming_thread`);
--> statement-breakpoint
CREATE INDEX `terminal_intent_outgoing_idx` ON `terminal_intent` (`outgoing_thread`);
--> statement-breakpoint
CREATE INDEX `terminal_operation_execution_idx` ON "terminal_request_key" (`execution_id`);
--> statement-breakpoint
CREATE INDEX `terminal_operation_occupancy_idx` ON "terminal_request_key" (`project_id`) WHERE outcome != 'expired';
--> statement-breakpoint
CREATE INDEX `terminal_operation_requester_idx` ON "terminal_request_key" (`project_id`,`requester`);
--> statement-breakpoint
CREATE INDEX `terminal_operation_retention_idx` ON "terminal_request_key" (`outcome`,`at`,`project_id`,`operation_id`);
--> statement-breakpoint
CREATE INDEX `terminal_place_idx` ON `terminal` (`project_id`,`root_id`);
--> statement-breakpoint
CREATE INDEX `terminal_project_idx` ON `terminal` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminal_shell_key_idx` ON `terminal` (`shell_key`);
--> statement-breakpoint
CREATE INDEX `terminal_standing_idx` ON `terminal` (`project_id`,`discharged_at`,`accepted_at`);
--> statement-breakpoint
CREATE INDEX `terminal_thread_idx` ON `terminal` (`held_by_thread`);
--> statement-breakpoint
CREATE INDEX `terminal_undischarged_idx` ON `terminal` (`accepted_at`) WHERE "terminal"."discharged_at" is null;
--> statement-breakpoint
CREATE INDEX `thread_archived_idx` ON `thread` (`project_id`,`archived_at`);
--> statement-breakpoint
CREATE INDEX `thread_cache_observation_provider_gap` ON `thread_cache_observation` (`provider`,`gap_ms`,`id`);
--> statement-breakpoint
CREATE INDEX `thread_call_thread_idx` ON `thread_call` (`thread_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_compaction_checkpoint_hash_unique` ON `thread_compaction_checkpoint` (`thread_id`,`covered_prefix_hash`);
--> statement-breakpoint
CREATE INDEX `thread_compaction_checkpoint_latest_idx` ON `thread_compaction_checkpoint` (`thread_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `thread_detached_idx` ON `thread` (`detached_from`) WHERE "thread"."detached_from" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_entry_id_unique` ON `thread_entry` (`thread_id`,`entry_id`);
--> statement-breakpoint
CREATE INDEX `thread_entry_run_idx` ON `thread_entry` (`thread_id`,`run_id`,`ord`);
--> statement-breakpoint
CREATE INDEX `thread_entry_tool_length_idx` ON `thread_entry` (length("entry")) WHERE "thread_entry"."type" = 'tool';
--> statement-breakpoint
CREATE INDEX `thread_entry_type_idx` ON `thread_entry` (`type`,`thread_id`);
--> statement-breakpoint
CREATE INDEX `thread_event_entry_idx` ON `thread_event` (`thread_id`,case
    when json_extract("payload", '$.entry.toolCallId') is not null
      then 'tool:' || coalesce(json_extract("payload", '$.entry.runId'), '') || ':' ||
           json_extract("payload", '$.entry.toolCallId')
    else json_extract("payload", '$.entry.id')
  end,`position`) WHERE json_extract("thread_event"."payload", '$.entry.id') is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_event_id_unique` ON `thread_event` (`id`);
--> statement-breakpoint
CREATE INDEX `thread_folder_idx` ON `thread` (`project_id`,`folder_id`) WHERE "thread"."folder_id" is not null;
--> statement-breakpoint
CREATE INDEX `thread_folder_project_idx` ON `thread_folder` (`project_id`,`parent_id`,`position`);
--> statement-breakpoint
CREATE INDEX `thread_inbox_open_request_idx` ON `thread_inbox` (`thread_id`,`kind`,`closed_at`,`occurred_at`,`seq`);
--> statement-breakpoint
CREATE INDEX `thread_inbox_run_idx` ON `thread_inbox` (`delivered_to_run_id`,`state`);
--> statement-breakpoint
CREATE INDEX `thread_inbox_seq_idx` ON `thread_inbox` (`seq`);
--> statement-breakpoint
CREATE INDEX `thread_inbox_thread_idx` ON `thread_inbox` (`thread_id`,`state`,`occurred_at`,`seq`);
--> statement-breakpoint
CREATE INDEX `thread_inbox_wake_at_idx` ON `thread_inbox_wake` (`at`);
--> statement-breakpoint
CREATE INDEX `thread_mandate_host_idx` ON `thread_mandate` (`host_kind`,`host_id`);
--> statement-breakpoint
CREATE INDEX `thread_message_appeared_idx` ON `thread_message` (`thread_id`,`appeared`);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_message_entry_unique` ON `thread_message` (`thread_id`,`entry_id`);
--> statement-breakpoint
CREATE INDEX `thread_message_position_idx` ON `thread_message` (`thread_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_name_unique` ON `thread` (`principal_id`,`spawn_root_id`,`name`);
--> statement-breakpoint
CREATE INDEX `thread_parent_idx` ON `thread` (`parent_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `thread_pinned_idx` ON `thread` (`project_id`,`pinned_at`) WHERE "thread"."pinned_at" is not null;
--> statement-breakpoint
CREATE INDEX `thread_project_idx` ON `thread` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `thread_reader_order_idx` ON `thread` (`project_id`,`reader_order_at`) WHERE "thread"."archived_at" is null;
--> statement-breakpoint
CREATE INDEX `thread_resource_thread` ON `thread_resource` (`thread_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_run_active_unique` ON `thread_run` (`thread_id`) WHERE "thread_run"."status" = 'running';
--> statement-breakpoint
CREATE INDEX `thread_run_ended_idx` ON `thread_run` (`thread_id`,`finished_at`,`id`) WHERE "thread_run"."status" in ('completed', 'failed', 'aborted', 'cut', 'withdrawn');
--> statement-breakpoint
CREATE INDEX `thread_run_heartbeat_idx` ON `thread_run` (`status`,`heartbeat_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_run_start_key_unique` ON `thread_run` (`thread_id`,`start_key`) WHERE "thread_run"."start_key" is not null;
--> statement-breakpoint
CREATE INDEX `thread_run_tally_unseen_idx` ON `thread_run_tally` (`thread_id`) WHERE "thread_run_tally"."unseen" = 1;
--> statement-breakpoint
CREATE INDEX `thread_run_terminal_idx` ON `thread_run` (`thread_id`,`id`) WHERE "thread_run"."status" in ('completed', 'failed', 'aborted', 'cut', 'withdrawn');
--> statement-breakpoint
CREATE INDEX `thread_run_thread_idx` ON `thread_run` (`thread_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `thread_spawn_root_idx` ON `thread` (`spawn_root_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `thread_target_operation_thread_idx` ON `thread_target_operation` (`thread_id`);
--> statement-breakpoint
CREATE INDEX `touch_place_idx` ON `touch` (`place`);
--> statement-breakpoint
CREATE UNIQUE INDEX `touch_task_place_idx` ON `touch` (`task_id`,`place`);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_line_change_idx` ON `transcript_line` (`listening_id`,`change`);
--> statement-breakpoint
CREATE INDEX `workflow_run_project_idx` ON `workflow_run` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `workspace_change_checkout_at_idx` ON `workspace_change` (`checkout`,`at`);
--> statement-breakpoint
CREATE INDEX `workspace_change_held_after_idx` ON `workspace_change` (`after_hash`) WHERE "workspace_change"."state" in ('writing', 'held');
--> statement-breakpoint
CREATE INDEX `workspace_change_held_before_idx` ON `workspace_change` (`before_hash`) WHERE "workspace_change"."state" in ('writing', 'held');
--> statement-breakpoint
CREATE INDEX `workspace_change_held_folded_idx` ON `workspace_change` (`checkout`,lower("path")) WHERE "workspace_change"."state" in ('writing', 'held');
--> statement-breakpoint
CREATE INDEX `workspace_change_held_place_idx` ON `workspace_change` (`checkout`,`path`) WHERE "workspace_change"."state" = 'held';
--> statement-breakpoint
CREATE INDEX `workspace_change_holder_idx` ON `workspace_change` (`holder`,`at`);
--> statement-breakpoint
CREATE INDEX `workspace_change_holder_path_idx` ON `workspace_change` (`holder`,`path`);
--> statement-breakpoint
CREATE INDEX `workspace_change_moved_from_idx` ON `workspace_change` (`checkout`,`moved_from`) WHERE "workspace_change"."state" in ('writing', 'held') and "workspace_change"."moved_from" is not null;
--> statement-breakpoint
CREATE INDEX `workspace_change_place_idx` ON `workspace_change` (`checkout`,`path`);
--> statement-breakpoint
CREATE INDEX `workspace_change_project_held_idx` ON `workspace_change` (`project_id`,`at`) WHERE "workspace_change"."state" = 'held';
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_change_record_key_idx` ON `workspace_change` ("holder",`record_key`);
--> statement-breakpoint
CREATE INDEX `workspace_change_retired_texts_idx` ON `workspace_change` (`id`) WHERE "workspace_change"."state" in ('committed', 'withdrawn') and ("workspace_change"."old_text" is not null or "workspace_change"."new_text" is not null);
--> statement-breakpoint
CREATE INDEX `workspace_change_standing_order_idx` ON `workspace_change` (`checkout`,`path`,`at`,`id`) WHERE "workspace_change"."state" in ('writing', 'held');
--> statement-breakpoint
CREATE INDEX `workspace_change_writing_idx` ON `workspace_change` (`checkout`) WHERE "workspace_change"."state" = 'writing';
--> statement-breakpoint
CREATE INDEX `worktree_archive_intent_at_idx` ON `worktree_archive_intent` (`at`,`key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_archive_intent_root_idx` ON `worktree_archive_intent` (`root_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_operation_held_destination_idx` ON `worktree_operation` (`namespace_id`,`destination`) WHERE "worktree_operation"."reserved" = 1 and "worktree_operation"."status" in ('pending', 'uncertain') and "worktree_operation"."abandonment" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_operation_held_ref_idx` ON `worktree_operation` (`namespace_id`,`repository_id`,`branch`) WHERE "worktree_operation"."reserved" = 1 and "worktree_operation"."status" in ('pending', 'uncertain') and "worktree_operation"."abandonment" is null;
--> statement-breakpoint
CREATE INDEX `worktree_pending_merge_project_idx` ON `worktree_pending_merge` (`project_id`);
--> statement-breakpoint
CREATE INDEX `worktree_project_idx` ON `worktree` (`project_id`,`archived_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `worktree_project_name_idx` ON `worktree` (`project_id`,`name`);
--> statement-breakpoint
CREATE TRIGGER `native_thread_rev_update` AFTER UPDATE OF `cache_group`, `profile`, `account`, `provider`, `model`, `reasoning`, `switches`, `system_prompt`, `pending_interaction`, `pending_system_prompt`, `failure_reason`, `context_reading`, `context_event_id`, `world_state_snapshot`, `world_state_checkpoint_id` ON `native_thread` WHEN OLD.`cache_group` IS NOT NEW.`cache_group` OR OLD.`profile` IS NOT NEW.`profile` OR OLD.`account` IS NOT NEW.`account` OR OLD.`provider` IS NOT NEW.`provider` OR OLD.`model` IS NOT NEW.`model` OR OLD.`reasoning` IS NOT NEW.`reasoning` OR OLD.`switches` IS NOT NEW.`switches` OR OLD.`system_prompt` IS NOT NEW.`system_prompt` OR OLD.`pending_interaction` IS NOT NEW.`pending_interaction` OR OLD.`pending_system_prompt` IS NOT NEW.`pending_system_prompt` OR OLD.`failure_reason` IS NOT NEW.`failure_reason` OR OLD.`context_reading` IS NOT NEW.`context_reading` OR OLD.`context_event_id` IS NOT NEW.`context_event_id` OR OLD.`world_state_snapshot` IS NOT NEW.`world_state_snapshot` OR OLD.`world_state_checkpoint_id` IS NOT NEW.`world_state_checkpoint_id` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`, `inherit_rev`) VALUES (NEW.`id`, 1, CASE WHEN OLD.`cache_group` IS NOT NEW.`cache_group` OR OLD.`profile` IS NOT NEW.`profile` OR OLD.`account` IS NOT NEW.`account` OR OLD.`provider` IS NOT NEW.`provider` OR OLD.`model` IS NOT NEW.`model` OR OLD.`reasoning` IS NOT NEW.`reasoning` OR OLD.`switches` IS NOT NEW.`switches` OR OLD.`system_prompt` IS NOT NEW.`system_prompt` THEN 1 ELSE 0 END) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1, `inherit_rev` = `inherit_rev` + excluded.`inherit_rev`; END;
--> statement-breakpoint
CREATE TRIGGER `search_index_ad` AFTER DELETE ON `search_index` BEGIN
  INSERT INTO `search_fts`(`search_fts`, `rowid`, `text`) VALUES ('delete', old.`block_id`, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_index_ai` AFTER INSERT ON `search_index` BEGIN
  INSERT INTO `search_fts`(`rowid`, `text`) VALUES (new.`block_id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `search_index_au` AFTER UPDATE ON `search_index` BEGIN
  INSERT INTO `search_fts`(`search_fts`, `rowid`, `text`) VALUES ('delete', old.`block_id`, old.`text`);
  INSERT INTO `search_fts`(`rowid`, `text`) VALUES (new.`block_id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `terminal_request_key_tally_ad` AFTER DELETE ON `terminal_request_key` BEGIN
  UPDATE `terminal_request_key_tally` SET `count` = `count` - 1 WHERE `outcome` = old.`outcome`;
END;
--> statement-breakpoint
CREATE TRIGGER `terminal_request_key_tally_ai` AFTER INSERT ON `terminal_request_key` BEGIN
  INSERT INTO `terminal_request_key_tally` (`outcome`, `count`) VALUES (new.`outcome`, 1)
  ON CONFLICT (`outcome`) DO UPDATE SET `count` = `count` + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `terminal_request_key_tally_au` AFTER UPDATE OF `outcome` ON `terminal_request_key`
WHEN old.`outcome` IS NOT new.`outcome` BEGIN
  UPDATE `terminal_request_key_tally` SET `count` = `count` - 1 WHERE `outcome` = old.`outcome`;
  INSERT INTO `terminal_request_key_tally` (`outcome`, `count`) VALUES (new.`outcome`, 1)
  ON CONFLICT (`outcome`) DO UPDATE SET `count` = `count` + 1;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_cache_observation_fold_rev_delete` AFTER DELETE ON `thread_cache_observation` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_cache_observation_fold_rev_insert` AFTER INSERT ON `thread_cache_observation` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_cache_observation_fold_rev_update` AFTER UPDATE ON `thread_cache_observation` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_compaction_checkpoint_fold_rev_delete` AFTER DELETE ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_compaction_checkpoint_fold_rev_insert` AFTER INSERT ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_compaction_checkpoint_fold_rev_update` AFTER UPDATE ON `thread_compaction_checkpoint` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_fold_rev_delete` AFTER DELETE ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_fold_rev_insert` AFTER INSERT ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_entry_fold_rev_update` AFTER UPDATE ON `thread_entry` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_fold_rev_delete` AFTER DELETE ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_fold_rev_insert` AFTER INSERT ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_event_fold_rev_update` AFTER UPDATE ON `thread_event` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_history_item_fold_rev_delete` AFTER DELETE ON `thread_history_item` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_history_item_fold_rev_insert` AFTER INSERT ON `thread_history_item` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_history_item_fold_rev_update` AFTER UPDATE ON `thread_history_item` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_log_fold_rev_delete` AFTER DELETE ON `thread_log` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_log_fold_rev_insert` AFTER INSERT ON `thread_log` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_log_fold_rev_update` AFTER UPDATE ON `thread_log` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_mandate_inherit_rev_update` AFTER UPDATE OF `authority`, `host_kind`, `host_id` ON `thread_mandate` WHEN OLD.`authority` IS NOT NEW.`authority` OR OLD.`host_kind` IS NOT NEW.`host_kind` OR OLD.`host_id` IS NOT NEW.`host_id` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `inherit_rev`) SELECT NEW.`id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`id`) ON CONFLICT (`thread_id`) DO UPDATE SET `inherit_rev` = `inherit_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_message_ad` AFTER DELETE ON `thread_message` BEGIN
  DELETE FROM `thread_message_fts` WHERE `rowid` = old.`key`;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_tool_call_fold_rev_delete` AFTER DELETE ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_tool_call_fold_rev_insert` AFTER INSERT ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
--> statement-breakpoint
CREATE TRIGGER `thread_pruned_tool_call_fold_rev_update` AFTER UPDATE ON `thread_pruned_tool_call` BEGIN INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT NEW.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = NEW.`thread_id`) ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; INSERT INTO `native_thread_rev` (`thread_id`, `fold_rev`) SELECT OLD.`thread_id`, 1 WHERE EXISTS (SELECT 1 FROM `native_thread` WHERE `id` = OLD.`thread_id`) AND OLD.`thread_id` IS NOT NEW.`thread_id` ON CONFLICT (`thread_id`) DO UPDATE SET `fold_rev` = `fold_rev` + 1; END;
