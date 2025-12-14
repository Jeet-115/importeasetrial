import { contextBridge, ipcRenderer } from "electron";

const safeInvoke = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((error) => {
    console.error(`[preload] ${channel} failed:`, error);
    throw error;
  });

contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => safeInvoke("ping"),

  getDeviceId: () => safeInvoke("get-device-id"),

  readJson: async (filename) => {
    const result = await safeInvoke("read-json", filename);
    if (result === undefined || result === null) {
      return {};
    }
    return result;
  },

  writeJson: (filename, data) => safeInvoke("write-json", filename, data),

  invokeApi: (path, options = {}) =>
    safeInvoke("proxy-api", { path, options }),
});

