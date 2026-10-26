import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';

export const CapabilitySettingsReading = Schema.Struct({ revision: Schema.String, disabled: Schema.Array(Schema.String) });

export const CHANGE_WAIT_MS = 30_000;

export const CAPABILITY_OPERATIONS = {
  read_capability_settings: operation('read_capability_settings', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: undefined,
    callers: 'any',
    subject: 'head',
    place: 'machine',
    graph: 'none',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    meaning: `Read which capabilities settings switch off in the current project, or at the operator layer outside a project; with after, wait until that reading changes, ${CHANGE_WAIT_MS} ms at most, then answer the reading as it stands.`,
    input: Schema.Struct({ after: Schema.optional(Schema.String) }),
    answer: arms({ read: CapabilitySettingsReading.fields }),
    refusals: [],
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the capabilities switched off in this project?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading capability settings',
      done: 'Read capability settings',
      many: (count) => `Read capability settings ${count} times`,
    },
  }),
};
