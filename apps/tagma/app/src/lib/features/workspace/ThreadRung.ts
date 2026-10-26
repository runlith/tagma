import { Rung } from '@runlith/layer/Rung';
import { ProjectRung } from './ProjectRung.js';

export type ThreadAim = { readonly id: string };

export const ThreadRung = Rung.define<ThreadAim>()('thread', { keyOf: ({ id }) => id, under: ProjectRung });

export const ThreadRungSource = ThreadRung.of(() => undefined);
