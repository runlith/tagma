import type { Section } from '../../platform/contract/wire/section.js';
import { browserCapability } from '../contract/wire/capability.js';

export const browserPages: Section = () => `- ${browserCapability.guide}`;
