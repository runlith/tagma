import { Layer } from 'effect';
import { Editors } from './contract/service/editors.js';
import { makeEditors } from './installed.js';

export const editorsLayer = Layer.effect(Editors, makeEditors);
