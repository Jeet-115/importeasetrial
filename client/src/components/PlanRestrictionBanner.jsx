import { useAuth } from "../context/AuthContext.jsx";
import { getPlanRestrictionMessage } from "../utils/planAccess.js";

const PlanRestrictionBanner = ({ className = "" }) => {
  const { user, isPlanRestricted } = useAuth();

  if (!user || user.isMaster || !isPlanRestricted) {
    return null;
  }

  return (
    <div
      className={`rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow ${className}`}
    >
      <p className="font-semibold">Read-only access</p>
      <p className="mt-1 text-xs">
        {getPlanRestrictionMessage(user.planStatus)}
      </p>
    </div>
  );
};

export default PlanRestrictionBanner;


