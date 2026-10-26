UPDATE `command_window` SET `moves` = (
	SELECT json_group_array(
		json_set(
			json_remove(`each`.`value`, '$.writtenAt'),
			'$.written',
			json(CASE
				WHEN json_extract(`each`.`value`, '$.writtenAt') IS NULL THEN 'null'
				WHEN json_extract(`each`.`value`, '$.present') = 0 AND `command_window`.`window_from` IS NOT NULL
					THEN json_object('from', `command_window`.`window_from`, 'to', json_extract(`each`.`value`, '$.writtenAt'))
				ELSE json_object('from', json_extract(`each`.`value`, '$.writtenAt'), 'to', json_extract(`each`.`value`, '$.writtenAt'))
			END)
		)
	)
	FROM json_each(`command_window`.`moves`) AS `each`
) WHERE `moves` IS NOT NULL;
