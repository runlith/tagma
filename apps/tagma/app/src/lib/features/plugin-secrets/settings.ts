import Section from '$lib/features/plugin-secrets/Section.svelte';
import type { SectionContribution } from '$lib/features/settings/section.js';

export const contributions: readonly SectionContribution[] = [{ section: 'plugins', order: 10, view: Section }];
