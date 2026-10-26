import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windowBehaviorExample', {
  getState: () => ipcRenderer.invoke('example:minimal:get-state'),
  getMeta: () => ipcRenderer.invoke('example:minimal:get-meta'),
  hideWindow: () => ipcRenderer.invoke('example:minimal:hide-window'),
  revealWindow: (options) => ipcRenderer.invoke('example:minimal:reveal-window', options),
  dispatch: (command) => ipcRenderer.invoke('example:minimal:dispatch', command),
  requestInteractiveFocus: () => ipcRenderer.invoke('example:minimal:request-focus'),
  releaseInteractiveFocus: () => ipcRenderer.invoke('example:minimal:release-focus'),
  subscribe(listener) {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('example:minimal:state', wrapped);
    return () => {
      ipcRenderer.removeListener('example:minimal:state', wrapped);
    };
  },
});
