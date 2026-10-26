import type { Section } from '../../platform/contract/wire/section.js';

export const settingKeys: Section = () => `## Settings

Name a setting to the operator by its exact key in backticks — \`telemetry.cpuSampler\` — never by its title or a paraphrase: the feed turns the key into a control he switches in place.
`;
