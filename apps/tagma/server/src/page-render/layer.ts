import { Layer } from 'effect';
import { Film } from '../artifacts/contract/service/film.js';
import { Render } from '../artifacts/contract/service/render.js';
import { Clips } from '../browser/contract/service/clips.js';
import { makeClips } from './clips.js';
import { makeFilm } from './film.js';
import { makeRender } from './render.js';

const render = Layer.effect(Render, makeRender);

export const clipsLayer = Layer.effect(Clips, makeClips);

export const renderLayer = Layer.mergeAll(render, Layer.effect(Film, makeFilm).pipe(Layer.provide(render)), clipsLayer);
