import { expect, test } from 'vitest';
import { placeFolder } from './folderDrop.js';

const folders = [
  { id: 'a', name: 'A', position: 0, parentId: null },
  { id: 'b', name: 'B', position: 1, parentId: null },
  { id: 'c', name: 'C', position: 2, parentId: null },
  { id: 'a1', name: 'A1', position: 0, parentId: 'a' },
  { id: 'a2', name: 'A2', position: 1, parentId: 'a' },
];

test('a dragged folder lands where the pointer says, counted among its new siblings once it stands there', () => {
  expect(placeFolder(folders, 'c', { kind: 'before', folderId: 'a' })).toEqual({ parentId: null, index: 0 });
  expect(placeFolder(folders, 'a', { kind: 'before', folderId: 'c' })).toEqual({ parentId: null, index: 1 });
  expect(placeFolder(folders, 'c', { kind: 'into', folderId: 'a' })).toEqual({ parentId: 'a', index: 2 });
  expect(placeFolder(folders, 'a1', { kind: 'before', folderId: 'b' })).toEqual({ parentId: null, index: 1 });
  expect(placeFolder(folders, 'a2', { kind: 'root' })).toEqual({ parentId: null, index: 3 });
});

test('a folder is never dropped into itself or its own subfolders, and a drop that changes nothing places nothing', () => {
  expect(placeFolder(folders, 'a', { kind: 'into', folderId: 'a1' })).toBeNull();
  expect(placeFolder(folders, 'a', { kind: 'into', folderId: 'a' })).toBeNull();
  expect(placeFolder(folders, 'b', { kind: 'before', folderId: 'c' })).toBeNull();
  expect(placeFolder(folders, 'c', { kind: 'root' })).toBeNull();
  expect(placeFolder(folders, 'a2', { kind: 'into', folderId: 'a' })).toBeNull();
});
