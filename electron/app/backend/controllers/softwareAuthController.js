import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { User } from "../models/User.js";
import { determinePlanStatus } from "../utils/subscriptionStatus.js";

const getMasterEmails = () =>
  (process.env.MASTER_ACCOUNTS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const generateSoftwareToken = () =>
  `SW-${crypto.randomBytes(24).toString("hex")}`;

export const loginSoftware = async (req, res) => {
  try {
    const { email, password, deviceId } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const masterEmails = getMasterEmails();
    const isMaster =
      user.isMaster || masterEmails.includes(user.email.toLowerCase());

    user.isMaster = isMaster;

    if (!isMaster) {
      if (!user.deviceId) {
        if (!deviceId) {
          return res.status(400).json({
            success: false,
            message: "Device ID is required for this account.",
          });
        }
        user.deviceId = deviceId;
      } else if (deviceId && user.deviceId !== deviceId) {
        return res.status(403).json({
          success: false,
          message: "This account is already connected with another system. You can't login on 2 systems with the same account.",
          errorCode: "DEVICE_MISMATCH",
        });
      }
    } else {
      user.deviceId = null;
      if (!user.subscriptionExpiry) {
        user.subscriptionExpiry = new Date("2099-01-01T00:00:00.000Z");
      }
    }

    if (!user.softwareToken) {
      user.softwareToken = generateSoftwareToken();
    }

    await user.save();

    const planStatus = determinePlanStatus({
      isMaster,
      subscriptionActive: user.subscriptionActive,
      subscriptionExpiry: user.subscriptionExpiry,
    });

    return res.json({
      success: true,
      softwareToken: user.softwareToken,
      subscriptionActive:
        user.subscriptionActive === false ? false : true,
      subscriptionExpiry: user.subscriptionExpiry,
      deviceId: isMaster ? null : user.deviceId,
      isMaster,
      planStatus,
    });
  } catch (error) {
    console.error("[controller] loginSoftware failed:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


