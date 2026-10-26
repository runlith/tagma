UPDATE `protocol_session` SET `row` = json_set(json_remove(`row`, '$.rewind'), '$.configured', json('null'), '$.cut', json('null'));
--> statement-breakpoint
UPDATE `external_session`
SET `facet` = json_set(`facet`, '$.sessionKey', json('null'), '$.observation.binding.rootKey', json('null'))
WHERE json_extract(`facet`, '$.name') = 'claude'
  AND json_extract(`facet`, '$.sessionKey') IS NOT NULL
  AND coalesce(json_extract(`facet`, '$.session.state'), 'ended') NOT IN ('starting', 'running', 'stopping', 'uncertain')
  AND `id` IN (SELECT `id` FROM `native_thread` WHERE json_extract(`transport`, '$.adapter') = 'acp');
--> statement-breakpoint
UPDATE `native_thread` SET `capabilities` = json_set(`capabilities`, '$.modelMove', 'live')
WHERE json_extract(`transport`, '$.adapter') = 'acp';
