import { SettingSections } from '$lib/features/settings/section.js';
import { sections } from './settings.js';

export const TelemetryLayer = SettingSections.contribute('telemetry', ...sections);
