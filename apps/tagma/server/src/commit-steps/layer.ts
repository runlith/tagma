import { Layer } from 'effect';
import { CommitShape } from '../change-record/contract/service/shape.js';
import { makeCommitShape } from './shape.js';

export const commitShapeLayer = Layer.effect(CommitShape, makeCommitShape);
