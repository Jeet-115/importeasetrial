const isElectron = () =>
  typeof window !== "undefined" && !!window.electronAPI;

export const getDeviceId = async () => {
  if (isElectron() && window.electronAPI.getDeviceId) {
    return window.electronAPI.getDeviceId();
  }

  // Fallback for browser / non-electron: generate a stable random ID
  try {
    const key = "fallbackDeviceId";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const randomId = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, randomId);
    return randomId;
  } catch {
    return null;
  }
};


