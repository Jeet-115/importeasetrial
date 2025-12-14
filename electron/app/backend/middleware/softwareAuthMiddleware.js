import { User } from "../models/User.js";
import {
  determinePlanStatus,
  getPlanRestrictionMessage,
  isPlanRestricted,
} from "../utils/subscriptionStatus.js";

const getMasterEmails = () =>
  (process.env.MASTER_ACCOUNTS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const softwareAuthGuard = async (req, res, next) => {
  try {
    const token = req.headers["x-software-token"];
    const headerDeviceId = req.headers["x-device-id"];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Missing software token.",
      });
    }

    const user = await User.findOne({ softwareToken: token });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid software token.",
      });
    }

    const masterEmails = getMasterEmails();
    const isMaster =
      user.isMaster || masterEmails.includes(user.email.toLowerCase());

    let planStatus = determinePlanStatus({
      isMaster,
      subscriptionActive: user.subscriptionActive,
      subscriptionExpiry: user.subscriptionExpiry,
    });
    const planLimited = isPlanRestricted({
      isMaster,
      subscriptionActive: user.subscriptionActive,
      subscriptionExpiry: user.subscriptionExpiry,
    });

    if (!isMaster) {
      if (user.deviceId) {
        if (!headerDeviceId || headerDeviceId !== user.deviceId) {
          return res.status(403).json({
            success: false,
            message: "This account is locked to another device.",
          });
        }
      }
    }

    req.softwareUser = {
      id: user._id.toString(),
      email: user.email,
      isMaster,
      planStatus,
      isPlanRestricted: planLimited,
    };

    next();
  } catch (error) {
    console.error("[middleware] softwareAuthGuard failed:", error);
    res.status(500).json({
      success: false,
      message: "Internal authentication error.",
    });
  }
};

export const requireActiveSubscription = (req, res, next) => {
  if (!req?.softwareUser) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  if (req.softwareUser.isMaster || !req.softwareUser.isPlanRestricted) {
    return next();
  }

  const planStatus = req.softwareUser.planStatus;

  return res.status(403).json({
    success: false,
    message: getPlanRestrictionMessage(planStatus),
    planStatus: planStatus || "inactive",
  });
};


