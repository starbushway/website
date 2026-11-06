import { contextBridge, ipcRenderer } from 'electron';
import type { Progress, StarbushApi } from '../src/app/api';

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: StarbushApi = {
  getState: call('getState') as StarbushApi['getState'],
  setup: call('setup') as StarbushApi['setup'],
  sync: call('sync') as StarbushApi['sync'],
  listPages: call('listPages') as StarbushApi['listPages'],
  readPage: call('readPage') as StarbushApi['readPage'],
  savePage: call('savePage') as StarbushApi['savePage'],
  addImage: call('addImage') as StarbushApi['addImage'],
  createPage: call('createPage') as StarbushApi['createPage'],
  linkingPages: call('linkingPages') as StarbushApi['linkingPages'],
  deletePage: call('deletePage') as StarbushApi['deletePage'],
  changes: call('changes') as StarbushApi['changes'],
  publish: call('publish') as StarbushApi['publish'],
  discard: call('discard') as StarbushApi['discard'],
  previewBase: call('previewBase') as StarbushApi['previewBase'],
  onProgress(callback) {
    const listener = (_: unknown, p: Progress) => callback(p);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
};

contextBridge.exposeInMainWorld('starbush', api);
