import { versionedShelf as versionedShelfFn } from '../shelf.js';
import { makeVideos as makeVideosValue } from '../videos.js';

export const versionedShelf = (...input: Parameters<typeof versionedShelfFn>) => versionedShelfFn(...input);

export const makeVideos = makeVideosValue;
