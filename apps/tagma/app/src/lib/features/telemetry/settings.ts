import Gauge from '@lucide/svelte/icons/gauge';
import type { SettingsSection } from '$lib/features/settings/section.js';
import TelemetrySection from '$lib/features/telemetry/TelemetrySection.svelte';

export const sections: readonly SettingsSection[] = [{ id: 'telemetry', group: 'machine', order: 7, icon: Gauge, view: TelemetrySection }];
