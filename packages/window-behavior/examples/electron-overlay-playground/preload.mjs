import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('windowBehaviorOverlayExample', {
  getState: () => ipcRenderer.invoke('example:overlay:get-state'),
  dispatch: (command) => ipcRenderer.invoke('example:overlay:dispatch', command),
  requestInteractiveFocus: () => ipcRenderer.invoke('example:overlay:request-focus'),
  releaseInteractiveFocus: () => ipcRenderer.invoke('example:overlay:release-focus'),
  subscribe(listener) {
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on('example:overlay:state', wrapped);
    return () => {
      ipcRenderer.removeListener('example:overlay:state', wrapped);
    };
  },
});
