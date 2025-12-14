import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getAuthData,
  setAuthData,
  clearAuthData,
} from "../utils/authStorage.js";
import { getDeviceId } from "../utils/device.js";
import { loginSoftware } from "../services/authService.js";
import {
  computePlanState,
  PLAN_STATUS,
} from "../utils/planAccess.js";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const stored = await getAuthData();
        if (!stored) {
          if (!cancelled) {
            setUser(null);
          }
          return;
        }

        if (!cancelled) {
          const enhanced = {
            ...stored,
            ...computePlanState(stored),
          };
          setUser(enhanced);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user || user.isMaster) return;

    const intervalId = setInterval(() => {
      setUser((current) => {
        if (!current || current.isMaster) return current;
        const planState = computePlanState(current);
        if (
          planState.planStatus === current.planStatus &&
          planState.isPlanRestricted === current.isPlanRestricted
        ) {
          return current;
        }
        const next = { ...current, ...planState };
        setAuthData(next);
        return next;
      });
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [user]);

  const login = useCallback(async (email, password) => {
    setLocked(false);
    setLockReason("");

    const deviceId = await getDeviceId();
    try {
      const result = await loginSoftware({ email, password, deviceId });

      if (!result?.success) {
        // Check if it's a device mismatch error
        if (result?.errorCode === "DEVICE_MISMATCH" || result?.message?.includes("another system") || result?.message?.includes("another device")) {
          const errorMsg = "The account is already connected with another system. You can't login on 2 systems with the same account.";
          setLocked(true);
          setLockReason(errorMsg);
          throw new Error(errorMsg);
        }
        throw new Error("Email and password don't match");
      }

      if (!result.isMaster && result.deviceId && deviceId && result.deviceId !== deviceId) {
        const errorMsg = "The account is already connected with another system. You can't login on 2 systems with the same account.";
        setLocked(true);
        setLockReason(errorMsg);
        throw new Error(errorMsg);
      }

    const basePayload = {
      email,
      softwareToken: result.softwareToken,
      isMaster: !!result.isMaster,
      subscriptionExpiry: result.subscriptionExpiry,
      subscriptionActive:
        result.subscriptionActive === false ? false : true,
      deviceId: result.deviceId || deviceId || null,
    };

      const planState = computePlanState(basePayload);
      const authPayload = {
        ...basePayload,
        ...planState,
      };

      setUser(authPayload);
      await setAuthData(authPayload);
    } catch (error) {
      // Re-throw the error so LoginScreen can handle it
      throw error;
    }
    }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setLocked(false);
    setLockReason("");
    await clearAuthData();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        locked,
        lockReason,
        login,
        logout,
        planStatus: user?.planStatus || PLAN_STATUS.ACTIVE,
        isPlanRestricted: !!user?.isPlanRestricted && !user?.isMaster,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);


