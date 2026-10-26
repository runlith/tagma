import type { SectionsModule } from '$lib/features/settings/section.js';
import { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';

export const DECLARED_SECTIONS = new SectionRegistry(import.meta.glob<SectionsModule>('../features/*/settings.ts', { eager: true }));
