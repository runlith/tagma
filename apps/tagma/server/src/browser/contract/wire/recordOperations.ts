import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { Glance } from './page.js';
import { RECORD_ACTIONS, Recorded, RECORDING_FPS, RECORDING_FPS_CEILING } from './recording.js';
import { ACTING, DRIVE_REFUSALS, page, project } from './shape.js';

export const RECORD_OPERATIONS = {
  record_page: operation('record_page', {
    ...ACTING,
    meaning: 'Record what a page shows into an MP4 video, from `start` to `stop`, to prove a flow or show it to the operator.',
    grammar: `\`start\` begins recording; act on the page with the usual tools, then \`stop\` answers the file, its duration and frame size, and the video plays in the thread. Frames are placed on an \`fps\` grid (${RECORDING_FPS} by default) and the last picture holds while the page does not change, so the clip lasts as long as the recording ran. A page holds one recording at a time: a second start refuses \`recording-running\`. A recording started by a thread stops when its run ends, and one ends when its page closes or its browser session is lost; each ending writes a complete file.`,
    input: Schema.Struct({
      project,
      page,
      action: Schema.Literals(RECORD_ACTIONS),
      fps: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: RECORDING_FPS_CEILING }))).annotate({
        description: `For start: frames per second, at most ${RECORDING_FPS_CEILING}.`,
      }),
    }),
    answer: arms({
      recording: {
        page: Glance,
        path: Schema.String.annotate({ description: 'Where the video is written once the recording stops.' }),
        fps: Schema.Int,
      },
      recorded: { page: Glance, ...Recorded.fields },
    }),
    refusals: [...DRIVE_REFUSALS, 'recording-running', 'no-recording', 'recording-failed'],
    confirmation: (input) => ({ summary: input.action === 'stop' ? 'Stop recording the page?' : 'Record the page?' }),
    confirmLabel: 'Record page',
    presentation: { running: 'Recording the page', done: 'Recorded the page' },
  }),
};

export type RecordOperationId = keyof typeof RECORD_OPERATIONS;
