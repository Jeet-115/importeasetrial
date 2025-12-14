const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const PLAN_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  EXPIRED: "expired",
};

export const determinePlanStatus = (user = {}) => {
  if (!user || user.isMaster) {
    return PLAN_STATUS.ACTIVE;
  }

  const expiryDate = toDate(user.subscriptionExpiry);
  if (expiryDate && expiryDate.getTime() <= Date.now()) {
    return PLAN_STATUS.EXPIRED;
  }

  if (user.subscriptionActive === false) {
    return PLAN_STATUS.INACTIVE;
  }

  return PLAN_STATUS.ACTIVE;
};

export const isPlanRestricted = (user = {}) =>
  !user?.isMaster && determinePlanStatus(user) !== PLAN_STATUS.ACTIVE;

export const getPlanRestrictionMessage = (status) => {
  if (status === PLAN_STATUS.EXPIRED) {
    return "Your subscription has expired. Renew to continue editing.";
  }
  return "Your subscription is inactive. Renew to continue editing.";
};


