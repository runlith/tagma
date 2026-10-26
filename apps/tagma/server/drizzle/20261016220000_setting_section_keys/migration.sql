UPDATE `setting`
SET `key` = CASE `key`
  WHEN 'agents.offered' THEN 'agent.offered'
  WHEN 'agents.modelGuidance' THEN 'agent.modelGuidance'
  WHEN 'agents.default' THEN 'agent.default'
  WHEN 'agents.web' THEN 'agent.web'
  WHEN 'files.autoSave' THEN 'editor.autoSave'
  WHEN 'files.autoSaveDelay' THEN 'editor.autoSaveDelay'
  WHEN 'performance.maxStoredBytes' THEN 'telemetry.maxStoredBytes'
  WHEN 'performance.maxPendingBytes' THEN 'telemetry.maxPendingBytes'
  WHEN 'performance.spanFloorMicros' THEN 'telemetry.spanFloorMicros'
  WHEN 'performance.keepOneTraceIn' THEN 'telemetry.keepOneTraceIn'
  WHEN 'performance.vitalsIntervalMs' THEN 'telemetry.vitalsIntervalMs'
  WHEN 'performance.metricsIntervalMs' THEN 'telemetry.metricsIntervalMs'
END
WHERE `key` IN (
  'agents.offered', 'agents.modelGuidance', 'agents.default', 'agents.web',
  'files.autoSave', 'files.autoSaveDelay',
  'performance.maxStoredBytes', 'performance.maxPendingBytes', 'performance.spanFloorMicros',
  'performance.keepOneTraceIn', 'performance.vitalsIntervalMs', 'performance.metricsIntervalMs'
);
