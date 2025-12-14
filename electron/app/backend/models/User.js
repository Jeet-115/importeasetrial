import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    subscriptionActive: {
      type: Boolean,
      default: false,
    },
    subscriptionExpiry: {
      type: Date,
      default: null,
    },
    subscriptionPlan: {
      type: String,
      default: null,
    },
    softwareToken: {
      type: String,
      default: null,
      index: true,
    },
    deviceId: {
      type: String,
      default: null,
    },
    isMaster: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

export const User = mongoose.model("User", userSchema);


