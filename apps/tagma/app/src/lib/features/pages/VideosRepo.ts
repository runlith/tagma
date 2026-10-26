import type { VideoScale } from '@tagma/server/artifacts/contract/wire/artifacts';
import { Repo } from '@runlith/query/repo';
import { Door } from '$lib/wire/Door.js';

export const VideosRepo = Repo.define(
  'page-videos',
  ({ mutation }) => ({
    export: mutation({
      mutator: async (asked: { page: string; version: string; scale: VideoScale }, { signal }, door) =>
        door.perform('export_artifact_video', asked, {}, { signal }),
    }),

    cancel: mutation({
      mutator: async (job: string, { signal }, door) => door.perform('cancel_artifact_video', { job }, {}, { signal }),
    }),
  }),
  { tier: 'app', door: Door },
);
