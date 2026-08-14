const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petApi", {
  getState: () => ipcRenderer.invoke("pet:get-state"),
  refreshUsage: () => ipcRenderer.invoke("pet:refresh-usage"),
  interact: (kind) => ipcRenderer.invoke("pet:interact", kind),
  care: (action) => ipcRenderer.invoke("pet:care", action),
  beginDrag: (point) => ipcRenderer.send("pet:drag-start", point),
  dragMove: (point) => ipcRenderer.send("pet:drag-move", point),
  endDrag: () => ipcRenderer.send("pet:drag-end"),
  setHovered: (hovered) => ipcRenderer.send("pet:hover", hovered),
  onState: (callback) => ipcRenderer.on("pet:state", (_event, value) => callback(value)),
  onFacing: (callback) => ipcRenderer.on("pet:facing", (_event, value) => callback(value)),
  onMotion: (callback) => ipcRenderer.on("pet:motion", (_event, value) => callback(value)),
  onReaction: (callback) => ipcRenderer.on("pet:reaction", (_event, value) => callback(value))
});
