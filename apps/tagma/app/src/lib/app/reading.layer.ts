import { Layer } from '@runlith/layer/Layer';
import { Seams } from '../shared/seams/Seams.svelte.js';
import { ReaderMarks } from '../shared/reading/ReaderMarks.svelte.js';
import { ReadState } from '../features/graph/ReadState.svelte.js';
import { Visits } from '../features/workspace/Visits.svelte.js';

export const ReadingLayer = Layer.mergeAll(ReaderMarks, ReadState, Visits, Seams);
