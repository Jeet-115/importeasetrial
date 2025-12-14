

import { HashRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Companymasters from "./pages/Companymasters.jsx";
import Companyselector from "./pages/Companyselector.jsx";
import CompanyselectorGstr2A from "./pages/CompanyselectorGstr2A.jsx";
import CompanyProcessor from "./pages/CompanyProcessor.jsx";
import CompanyProcessorGstr2A from "./pages/CompanyProcessorGstr2A.jsx";
import B2BHistory from "./pages/B2BHistory.jsx";
import B2BCompanyHistory from "./pages/B2BCompanyHistory.jsx";
import Gstr2AHistory from "./pages/Gstr2AHistory.jsx";
import CompanyHistoryGstr2A from "./pages/CompanyHistoryGstr2A.jsx";
import LedgerNameManager from "./pages/LedgerNameManager.jsx";
import PartyMasterManager from "./pages/PartyMasterManager.jsx";
import BackendStatusGate from "./components/BackendStatusGate.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import MasterBadge from "./components/MasterBadge.jsx";

const AppShell = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1 className="login-title">ImportEase</h1>
          <p className="login-subtitle">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <>
      <MasterBadge />
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/company-masters" element={<Companymasters />} />
          <Route path="/company-selector" element={<Companyselector />} />
          <Route path="/company-selector-gstr2a" element={<CompanyselectorGstr2A />} />
          <Route path="/company-processor" element={<CompanyProcessor />} />
          <Route path="/company-processor-gstr2a" element={<CompanyProcessorGstr2A />} />
          <Route path="/b2b-history" element={<B2BHistory />} />
          <Route
            path="/b2b-history/:companyId"
            element={<B2BCompanyHistory />}
          />
          <Route path="/gstr2a-history" element={<Gstr2AHistory />} />
          <Route
            path="/gstr2a-history/:companyId"
            element={<CompanyHistoryGstr2A />}
          />
          <Route path="/ledger-names" element={<LedgerNameManager />} />
          <Route path="/party-masters" element={<PartyMasterManager />} />
        </Routes>
      </HashRouter>
    </>
  );
};

const App = () => (
  <AuthProvider>
    <BackendStatusGate>
      <AppShell />
    </BackendStatusGate>
  </AuthProvider>
);

export default App;
