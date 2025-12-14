import { useEffect, useState } from "react";
import axiosInstance from "../utils/axiosInstance.js";

const HEALTH_ENDPOINT = "/health";
const HEALTH_CHECK_INTERVAL_MS = 15_000;

const BackendStatusGate = ({ children }) => {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const runCheck = async () => {
      try {
        await axiosInstance.get(HEALTH_ENDPOINT, { timeout: 2000 });
        if (!cancelled) {
          setOnline(true);
          setChecking(false);
        }
      } catch {
        if (!cancelled) {
          setOnline(false);
          setChecking(false);
        }
      }
    };

    runCheck();
    const intervalId = setInterval(runCheck, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <>
      {!checking && !online && (
        <div className="offline-banner">
          Unable to reach the local backend on http://localhost:5000. Please
          ensure the app backend is running, then retry.
        </div>
      )}
      {children}
    </>
  );
};

export default BackendStatusGate;

