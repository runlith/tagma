ALTER TABLE `thread_view_pin` RENAME COLUMN `plugin` TO `app`;
--> statement-breakpoint
UPDATE `setting` SET `key` = 'apps.installed' WHERE `key` = 'plugins.installed';
--> statement-breakpoint
UPDATE `setting` SET `key` = 'apps.enabled' WHERE `key` = 'plugins.enabled';
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(json(
    CASE WHEN json_type(value, '$.source') = 'text'
      THEN json_set(value, '$.source', replace(json_extract(value, '$.source'), '/.plugins/', '/.tagma-apps/'))
      ELSE value
    END
  )) FROM (SELECT value FROM json_each(`setting`.`value`) ORDER BY key)
)
WHERE `key` = 'apps.installed' AND json_valid(`value`) AND json_type(`value`) = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE instr(json_extract(value, '$.source'), '/.plugins/') > 0
);
--> statement-breakpoint
UPDATE `thread_mandate`
SET `bindings` = json_remove(json_set(`bindings`, '$.app', json_extract(`bindings`, '$.plugin')), '$.plugin')
WHERE json_valid(`bindings`) AND json_type(`bindings`, '$.plugin') IS NOT NULL AND json_type(`bindings`, '$.app') IS NULL;
--> statement-breakpoint
UPDATE `native_thread`
SET `profile` = json_set(`profile`, '$.overlay.capabilities', json((
  SELECT json_group_array(
    CASE WHEN value = 'plugins' THEN 'apps' WHEN substr(value, 1, 7) = 'plugin:' THEN 'app:' || substr(value, 8) ELSE value END
  ) FROM (SELECT value FROM json_each(`native_thread`.`profile`, '$.overlay.capabilities') ORDER BY key)
)))
WHERE json_valid(`profile`) AND json_type(`profile`, '$.overlay.capabilities') = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`native_thread`.`profile`, '$.overlay.capabilities') WHERE value = 'plugins' OR substr(value, 1, 7) = 'plugin:'
);
--> statement-breakpoint
UPDATE `native_thread`
SET `pending_definition` = json_set(`pending_definition`, '$.profile.overlay.capabilities', json((
  SELECT json_group_array(
    CASE WHEN value = 'plugins' THEN 'apps' WHEN substr(value, 1, 7) = 'plugin:' THEN 'app:' || substr(value, 8) ELSE value END
  ) FROM (SELECT value FROM json_each(`native_thread`.`pending_definition`, '$.profile.overlay.capabilities') ORDER BY key)
)))
WHERE json_valid(`pending_definition`) AND json_type(`pending_definition`, '$.profile.overlay.capabilities') = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`native_thread`.`pending_definition`, '$.profile.overlay.capabilities') WHERE value = 'plugins' OR substr(value, 1, 7) = 'plugin:'
);
--> statement-breakpoint
UPDATE `native_thread`
SET `profile` = json_set(`profile`, '$.overlay.tools', json((
  SELECT json_group_array(
    CASE WHEN substr(value, 1, 8) = 'plugin__' THEN 'app__' || substr(value, 9) ELSE value END
  ) FROM (SELECT value FROM json_each(`native_thread`.`profile`, '$.overlay.tools') ORDER BY key)
)))
WHERE json_valid(`profile`) AND json_type(`profile`, '$.overlay.tools') = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`native_thread`.`profile`, '$.overlay.tools') WHERE type = 'text' AND substr(value, 1, 8) = 'plugin__'
);
--> statement-breakpoint
UPDATE `native_thread`
SET `pending_definition` = json_set(`pending_definition`, '$.profile.overlay.tools', json((
  SELECT json_group_array(
    CASE WHEN substr(value, 1, 8) = 'plugin__' THEN 'app__' || substr(value, 9) ELSE value END
  ) FROM (SELECT value FROM json_each(`native_thread`.`pending_definition`, '$.profile.overlay.tools') ORDER BY key)
)))
WHERE json_valid(`pending_definition`) AND json_type(`pending_definition`, '$.profile.overlay.tools') = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`native_thread`.`pending_definition`, '$.profile.overlay.tools') WHERE type = 'text' AND substr(value, 1, 8) = 'plugin__'
);
--> statement-breakpoint
UPDATE `thread_mandate`
SET `approves` = (
  SELECT json_group_array(
    CASE WHEN substr(value, 1, 8) = 'plugin__' THEN 'app__' || substr(value, 9) ELSE value END
  ) FROM (SELECT value FROM json_each(`thread_mandate`.`approves`) ORDER BY key)
)
WHERE json_valid(`approves`) AND json_type(`approves`) = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`thread_mandate`.`approves`) WHERE type = 'text' AND substr(value, 1, 8) = 'plugin__'
);
--> statement-breakpoint
UPDATE `setting`
SET `value` = (
  SELECT json_group_array(
    CASE WHEN substr(value, 1, 8) = 'plugin__' THEN 'app__' || substr(value, 9) ELSE value END
  ) FROM (SELECT value FROM json_each(`setting`.`value`) ORDER BY key)
)
WHERE `setting`.`key` = 'agent.approves' AND json_valid(`setting`.`value`) AND json_type(`setting`.`value`) = 'array' AND EXISTS (
  SELECT 1 FROM json_each(`setting`.`value`) WHERE type = 'text' AND substr(value, 1, 8) = 'plugin__'
);
--> statement-breakpoint
UPDATE `schedule_run` SET `owner` = 'app:' || substr(`owner`, 8) WHERE substr(`owner`, 1, 7) = 'plugin:';
--> statement-breakpoint
UPDATE `notification` SET `sender` = 'app:' || substr(`sender`, 8) WHERE substr(`sender`, 1, 7) = 'plugin:';
--> statement-breakpoint
UPDATE `thread_call` SET `actor` = 'external.app:' || substr(`actor`, 17)
WHERE `operation` = 'input' AND substr(`actor`, 1, 16) = 'external.plugin:';
--> statement-breakpoint
UPDATE `spent_call_key` SET `actor` = 'external.app:' || substr(`actor`, 17)
WHERE `operation` = 'input' AND substr(`actor`, 1, 16) = 'external.plugin:';
