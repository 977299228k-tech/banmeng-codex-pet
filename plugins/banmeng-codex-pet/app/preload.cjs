const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petApi", {
  getState: () => ipcRenderer.invoke("pet:get-state"),
  refreshUsage: () => ipcRenderer.invoke("pet:refresh-usage"),
  onState: (callback) => ipcRenderer.on("pet:state", (_event, value) => callback(value)),
  onFacing: (callback) => ipcRenderer.on("pet:facing", (_event, value) => callback(value))
});
