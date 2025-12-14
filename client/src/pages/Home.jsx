import { motion } from "framer-motion";
import {
  FiBook,
  FiClipboard,
  FiCornerDownRight,
  FiLayers,
  FiSettings,
  FiUsers,
} from "react-icons/fi";
import logo from "/logo.png";
import { useNavigate } from "react-router-dom";

const Home = () => {
  const navigate = useNavigate();

  return (
    <motion.main
      className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-white p-6 text-slate-900 flex flex-col items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <motion.section
        className="w-full max-w-4xl rounded-3xl bg-white/90 shadow-lg border border-amber-100 p-8 space-y-6 text-center backdrop-blur"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex flex-col items-center gap-3">
          <img
            src={logo}
            alt="ImportEase logo"
            className="h-12 w-12 rounded-xl shadow-sm"
          />
          <p className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-amber-700">
            <FiCornerDownRight />
            Guided workflow
          </p>
        </div>
        <h1 className="text-4xl font-bold text-slate-900">
          ImportEase – GST imports made simple for CAs
        </h1>
        <p className="text-base text-slate-600 max-w-2xl mx-auto">
          Think of this as your assistant for GSTR-2B & GSTR-2A: first pick a company,
          then upload the Excel, review suggested ledgers and actions, and
          finally download a clean purchase register for Tally. Every screen
          explains the next step so non-technical users can follow along safely.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-left">
          {[
            {
              icon: <FiSettings />,
              title: "Company Masters",
              text: "Add / update client details (address, GSTIN, etc.). Do this once per client.",
              action: () => navigate("/company-masters"),
            },
            {
              icon: <FiLayers />,
              title: "Select & Process (GSTR-2B)",
              text: "For a selected client, upload GSTR-2B and prepare the purchase register step by step.",
              action: () => navigate("/company-selector"),
            },
            {
              icon: <FiClipboard />,
              title: "Review History (GSTR-2B)",
              text: "Open previous runs for a client, re-download Excel, or fix ledgers later.",
              action: () => navigate("/b2b-history"),
            },
            {
              icon: <FiLayers />,
              title: "Select & Process (GSTR-2A)",
              text: "For a selected client, upload GSTR-2A CSV and prepare the purchase register step by step.",
              action: () => navigate("/company-selector-gstr2a"),
            },
            {
              icon: <FiClipboard />,
              title: "Review History (GSTR-2A)",
              text: "Open previous GSTR-2A runs for a client, re-download Excel, or fix ledgers later.",
              action: () => navigate("/gstr2a-history"),
            },
            {
              icon: <FiBook />,
              title: "Ledger Names",
              text: "Define standard purchase ledgers you want to reuse while mapping invoices.",
              action: () => navigate("/ledger-names"),
            },
            {
              icon: <FiUsers />,
              title: "Manage Party Masters",
              text: "Maintain party-wise details to help with consistent ledger selection.",
              action: () => navigate("/party-masters"),
            },
          ].map(({ icon, title, text, action }) => (
            <button
              key={title}
              onClick={action}
              className="rounded-2xl border border-amber-100 bg-gradient-to-br from-white to-amber-50 p-4 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-center gap-3 text-amber-600 text-xl">
                {icon}
                <span className="text-base font-semibold text-slate-900">
                  {title}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{text}</p>
            </button>
          ))}
        </div>
      </motion.section>
    </motion.main>
  );
};

export default Home;

