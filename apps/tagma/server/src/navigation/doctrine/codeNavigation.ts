import type { Section } from '../../platform/contract/wire/section.js';
import { navigationCapability } from '../contract/wire/capability.js';

export const codeNavigation: Section = () => `- ${navigationCapability.guide}`;
