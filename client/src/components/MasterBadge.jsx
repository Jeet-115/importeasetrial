import { useMemo } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { getPlanRestrictionMessage } from "../utils/planAccess.js";

const MasterBadge = () => {
  const { user, logout, isPlanRestricted } = useAuth();

  if (!user) return null;

  const isMaster = !!user.isMaster;
  const badgeClass = useMemo(() => {
    if (isMaster) return "master-badge master-badge--master";
    if (isPlanRestricted) return "master-badge master-badge--restricted";
    return "master-badge master-badge--standard";
  }, [isMaster, isPlanRestricted]);

  const statusCopy =
    !isMaster && isPlanRestricted
      ? getPlanRestrictionMessage(user.planStatus)
      : null;
  const statusLabel =
    user?.planStatus === "expired" ? "Plan expired" : "Inactive plan";

  return (
    <div className={badgeClass}>
      {isMaster && <span className="master-badge-label">Master</span>}
      <div className="flex flex-col leading-tight">
        <span className="master-badge-email">{user.email}</span>
        {statusCopy ? (
          <span className="master-badge-status" title={statusCopy}>
            {statusLabel}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="master-badge-logout"
        onClick={logout}
        title="Logout"
      >
        Logout
      </button>
    </div>
  );
};

export default MasterBadge;



