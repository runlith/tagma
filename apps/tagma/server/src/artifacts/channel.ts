import { Stream } from 'effect';
import type { ArtifactStore } from './contract/service/shelf.js';
import type { Videos } from './contract/service/videos.js';
import { THREAD_PAGES_SHOWN } from './contract/wire/feed.js';

export const pagesChannel = (store: ArtifactStore['Service'], videos: Videos['Service']) => ({
  'artifacts.thread': ({ threads }: { readonly projectId: number; readonly threads: readonly string[] }) =>
    store.follow(threads, THREAD_PAGES_SHOWN),
  'artifacts.page': ({ id }: { readonly projectId: number; readonly id: string }) =>
    Stream.zipLatestWith(store.followPage(id), videos.follow(id), (shelf, made) => ({
      ...shelf,
      videos: made.filter((video) => shelf.kept.includes(video.version)),
    })),
});
