import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { TERMINAL_OPERATIONS } from '../../../executions/contract/wire/operations/terminalCatalog.js';

export const DEV_SURFACE_OPERATIONS = {
  start_dev_surface: operation('start_dev_surface', {
    approval: ASKS_NEVER,
    doors: { http: true },
    callers: 'operator',
    subject: 'none',
    place: 'machine',
    graph: 'none',
    waits: [],
    lifetimes: [],
    meaning: 'Serve the app of the checkout this server was cut from with Vite, and answer its address once it answers.',
    grammar:
      'A Vite already answering at the address is taken as it stands, and `started` is false. Otherwise the app of this checkout starts as a held terminal of the operator, which stays until it is stopped like any terminal, and the answer comes once the address answers. It refuses `dev-surface-no-checkout` when this server knows no checkout to serve from, `dev-surface-ended` with the last lines of its output when the terminal ended first, `dev-surface-uncertain` when the host could not vouch for the start, and with the refusal of the terminal start when that was refused.',
    input: Schema.Struct({}),
    answer: arms({ ready: { url: Schema.String, started: Schema.Boolean } }),
    refusals: ['dev-surface-no-checkout', 'dev-surface-ended', 'dev-surface-uncertain', ...TERMINAL_OPERATIONS.start_terminal.refusals],
    effect: 'external',
    identity: { key: 'call' },
    subjects: () => [],
    confirmation: () => ({ summary: 'Serve the app of this checkout with Vite?' }),
    confirmLabel: 'Serve',
    presentation: { running: 'Starting the app dev server', done: 'The app dev server answers' },
  }),
};
