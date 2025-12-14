export const PLAN_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
};

const toTimestamp = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
};

export const computePlanState = ({
  isMaster,
  subscriptionActive,
  subscriptionExpiry,
}) => {
  if (isMaster) {
    return {
      planStatus: PLAN_STATUS.ACTIVE,
      isPlanRestricted: false,
    };
  }

  const expiryTime = toTimestamp(subscriptionExpiry);
  if (expiryTime && expiryTime <= Date.now()) {
    return {
      planStatus: PLAN_STATUS.EXPIRED,
      isPlanRestricted: true,
    };
  }

  if (subscriptionActive === false) {
    return {
      planStatus: PLAN_STATUS.INACTIVE,
      isPlanRestricted: true,
    };
  }

  return {
    planStatus: PLAN_STATUS.ACTIVE,
    isPlanRestricted: false,
  };
};

export const getPlanRestrictionMessage = (status) => {
  if (status === PLAN_STATUS.EXPIRED) {
    return "Your plan has expired. Renew to unlock editing.";
  }
  return "Your plan is inactive. Renew to unlock editing.";
};


