UPDATE `external_session`
SET `facet` = json_set(json_remove(`facet`, '$.session.job'),
      '$.session.state', 'ended', '$.session.endedReason', 'identity-unproven'),
    `lease_owner` = NULL,
    `lease_beat` = NULL
WHERE json_valid(`facet`)
  AND json_extract(`facet`, '$.session.origin') = 'adopted'
  AND json_type(`facet`, '$.session.job.birth') IS NOT 'text';
