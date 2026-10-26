UPDATE `native_thread` SET `model` = 'claude-opus-5-5'
WHERE `provider` = 'claude-code' AND `model` IS NULL AND json_extract(`transport`, '$.agent') IS NOT NULL;
--> statement-breakpoint
UPDATE `native_thread`
SET `reasoning` = CASE `model`
  WHEN 'claude-opus-5-5' THEN 'medium'
  WHEN 'claude-haiku-5-5' THEN 'medium'
  WHEN 'claude-fable-5-1' THEN 'xhigh'
  WHEN 'claude-haiku-4-5' THEN NULL
  ELSE 'high'
END
WHERE `provider` = 'claude-code' AND `reasoning` IS NULL AND json_extract(`transport`, '$.agent') IS NOT NULL;
--> statement-breakpoint
UPDATE `setting` SET `value` = json_remove(`value`, '$.claude')
WHERE `key` = 'threads.harnessTransport' AND json_valid(`value`) AND json_type(`value`, '$.claude') IS NOT NULL;
