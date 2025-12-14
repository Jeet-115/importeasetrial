import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { FiBriefcase, FiUsers } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import { fetchCompanyMasters } from "../services/companymasterservices";

const CompanyselectorGstr2A = () => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const loadCompanies = async () => {
      try {
        const { data } = await fetchCompanyMasters();
        setCompanies(data || []);
      } catch (err) {
        console.error("Failed to load company masters:", err);
        setError("Unable to load companies. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    loadCompanies();
  }, []);

  const handleSelect = (company) => {
    navigate("/company-processor-gstr2a", { state: { company } });
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-white text-amber-800">
        Loading companies...
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-white text-rose-600">
        {error}
      </main>
    );
  }

  return (
    <motion.main
      className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <section className="mx-auto max-w-6xl space-y-5">
        <BackButton label="Back to dashboard" />
        <motion.header
          className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur space-y-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
            Step 1
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            Step 1: Choose the client you want to work on
          </h1>
          <p className="text-base text-slate-600">
            ImportEase will use this client&apos;s name, GSTIN and state for the
            purchase register. Pick the client first, then on the next screen
            you&apos;ll upload that client&apos;s GSTR-2A CSV file.
          </p>
        </motion.header>

        <motion.div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { staggerChildren: 0.05 },
            },
          }}
        >
          {companies.map((company) => (
            <motion.button
              key={company._id}
              onClick={() => handleSelect(company)}
              className="rounded-2xl border border-amber-100 bg-white/90 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md"
              variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
            >
              <div className="flex items-center gap-3 text-amber-600">
                <FiBriefcase />
                <span className="text-sm font-semibold uppercase tracking-wide text-amber-500">
                  Company Name
                </span>
              </div>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">
                {company.companyName}
              </h2>
              {company.gstin && (
                <p className="mt-1 text-sm text-slate-500">
                  GSTIN: {company.gstin}
                </p>
              )}
            </motion.button>
          ))}
        </motion.div>
      </section>
    </motion.main>
  );
};

export default CompanyselectorGstr2A;

