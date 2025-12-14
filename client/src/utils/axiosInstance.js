import axios from "axios";
import { getAuthData } from "./authStorage.js";

const DEFAULT_API_BASE_URL = "http://localhost:5000";
const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;

const axiosInstance = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

axiosInstance.interceptors.request.use(
  async (config) => {
    try {
      const auth = await getAuthData();
      if (auth?.softwareToken) {
        config.headers = config.headers || {};
        config.headers["x-software-token"] = auth.softwareToken;
        if (auth.deviceId) {
          config.headers["x-device-id"] = auth.deviceId;
        }
      }
    } catch {
      // ignore
    }
    return config;
  },
  (error) => Promise.reject(error),
);

export default axiosInstance;
