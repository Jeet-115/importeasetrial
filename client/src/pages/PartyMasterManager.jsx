import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  FiEdit2,
  FiFileText,
  FiPlus,
  FiRefreshCw,
  FiSave,
  FiSearch,
  FiTrash2,
  FiUpload,
  FiX,
} from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton.jsx";
import { fetchCompanyMasters } from "../services/companymasterservices.js";
import {
  createPartyMaster,
  deletePartyMaster,
  fetchPartyMasters,
  updatePartyMaster,
  uploadPurchaseRegister,
} from "../services/partymasterservice.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import PlanRestrictionBanner from "../components/PlanRestrictionBanner.jsx";
import { getPlanRestrictionMessage } from "../utils/planAccess.js";

const PartyMasterManager = () => {
  const { user, isPlanRestricted } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState("select"); // 'select', 'manage'
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [uploading, setUploading] = useState(false);
  const [newParty, setNewParty] = useState({ partyName: "", gstin: "" });
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState({ partyName: "", gstin: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmState, setConfirmState] = useState({
    open: false,
    targetId: null,
    targetName: "",
  });
  const [uploadFile, setUploadFile] = useState(null);

  const readOnly = !user?.isMaster && isPlanRestricted;
  const readOnlyMessage = readOnly
    ? getPlanRestrictionMessage(user?.planStatus)
    : "";

  useEffect(() => {
    const loadCompanies = async () => {
      setLoading(true);
      try {
        const { data } = await fetchCompanyMasters();
        setCompanies(data || []);
      } catch (error) {
        console.error("Failed to load companies:", error);
        setStatus({
          type: "error",
          message: "Unable to load companies. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    };
    loadCompanies();
  }, []);

  useEffect(() => {
    if (selectedCompany && step === "manage") {
      loadParties();
    }
  }, [selectedCompany, step]);

  useEffect(() => {
    if (!status.message) return;
    const timer = setTimeout(() => setStatus({ type: "", message: "" }), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const loadParties = async () => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const { data } = await fetchPartyMasters(selectedCompany._id);
      setParties(data || []);
    } catch (error) {
      console.error("Failed to load parties:", error);
      setStatus({
        type: "error",
        message: "Unable to load parties. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCompany = (company) => {
    setSelectedCompany(company);
    setStep("manage");
  };

  const handleBackToSelect = () => {
    setSelectedCompany(null);
    setStep("select");
    setParties([]);
  };

  const handleFileChange = (e) => {
    if (readOnly) {
      setStatus({
        type: "error",
        message: readOnlyMessage,
      });
      e.target.value = "";
      return;
    }
    const file = e.target.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "xls" && ext !== "xlsx") {
        setStatus({
          type: "error",
          message: "Please upload a .xls or .xlsx file.",
        });
        return;
      }
      setUploadFile(file);
    }
  };

  const handleUpload = async () => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    if (!uploadFile || !selectedCompany) {
      setStatus({
        type: "error",
        message: "Please select a file to upload.",
      });
      return;
    }

    setUploading(true);
    try {
      const { data } = await uploadPurchaseRegister(
        selectedCompany._id,
        uploadFile
      );
      setStatus({
        type: "success",
        message: `Successfully imported ${data.count} parties.`,
      });
      setUploadFile(null);
      await loadParties();
    } catch (error) {
      console.error("Failed to upload file:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Failed to upload file. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleAddParty = async (e) => {
    e.preventDefault();
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    const trimmedName = newParty.partyName.trim();
    const trimmedGstin = newParty.gstin.trim();

    if (!trimmedName || !trimmedGstin) {
      setStatus({
        type: "error",
        message: "Party name and GSTIN are required.",
      });
      return;
    }

    if (!selectedCompany) {
      setStatus({ type: "error", message: "No company selected." });
      return;
    }

    setSubmitting(true);
    try {
      await createPartyMaster({
        companyId: selectedCompany._id,
        partyName: trimmedName,
        gstin: trimmedGstin,
      });
      setNewParty({ partyName: "", gstin: "" });
      setStatus({ type: "success", message: "Party added successfully." });
      await loadParties();
    } catch (error) {
      console.error("Failed to create party:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to add party. Please retry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteParty = async (id, name) => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    setSubmitting(true);
    try {
      await deletePartyMaster(id);
      setStatus({ type: "success", message: "Party deleted successfully." });
      await loadParties();
    } catch (error) {
      console.error("Failed to delete party:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to delete party. Please retry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (party) => {
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    setEditingId(party._id);
    setEditingValue({ partyName: party.partyName, gstin: party.gstin });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingValue({ partyName: "", gstin: "" });
  };

  const handleUpdateParty = async (e) => {
    e.preventDefault();
    if (readOnly) {
      setStatus({ type: "error", message: readOnlyMessage });
      return;
    }
    const trimmedName = editingValue.partyName.trim();
    const trimmedGstin = editingValue.gstin.trim();

    if (!trimmedName || !trimmedGstin) {
      setStatus({
        type: "error",
        message: "Party name and GSTIN are required.",
      });
      return;
    }

    setSubmitting(true);
    try {
      await updatePartyMaster(editingId, {
        partyName: trimmedName,
        gstin: trimmedGstin,
      });
      setStatus({ type: "success", message: "Party updated successfully." });
      cancelEditing();
      await loadParties();
    } catch (error) {
      console.error("Failed to update party:", error);
      setStatus({
        type: "error",
        message:
          error?.response?.data?.message ||
          "Unable to update party. Please retry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredParties = parties.filter(
    (party) =>
      party.partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      party.gstin.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (step === "select") {
    return (
      <motion.main
        className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <section className="mx-auto max-w-6xl space-y-5">
          <BackButton label="Back to home" fallback="/" />

          <motion.header
            className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur space-y-3"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
              Party Masters
            </p>
            <h1 className="text-3xl font-bold text-slate-900">
              Select a company
            </h1>
            <p className="text-base text-slate-600">
              Choose a company to manage its party masters. You can upload a
              purchase register Excel file or manually add parties.
            </p>
          </motion.header>

          <PlanRestrictionBanner />

          {status.message ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm shadow ${
                status.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {status.message}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-500">
              <FiRefreshCw className="animate-spin text-lg" />
            </div>
          ) : (
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
                  onClick={() => handleSelectCompany(company)}
                  className="rounded-2xl border border-amber-100 bg-white/90 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 },
                  }}
                >
                  <div className="flex items-center gap-3 text-amber-600">
                    <FiFileText />
                    <span className="text-sm font-semibold uppercase tracking-wide text-amber-500">
                      {company.companyName}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    GSTIN: {company.gstin || "—"}
                  </p>
                </motion.button>
              ))}
            </motion.div>
          )}

          {!loading && !companies.length ? (
            <p className="text-center text-slate-500">
              No companies found. Create one first from Company Masters.
            </p>
          ) : null}
        </section>
      </motion.main>
    );
  }

  return (
    <motion.main
      className="min-h-screen bg-gradient-to-br from-amber-50 via-rose-50 to-white p-4 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <section className="mx-auto max-w-5xl space-y-5">
        <BackButton
          label="Back to company selection"
          onClick={handleBackToSelect}
        />

        <motion.header
          className="rounded-3xl border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg backdrop-blur space-y-3"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">
            Party Masters
          </p>
          <h1 className="text-3xl font-bold text-slate-900">
            {selectedCompany?.companyName || "Manage Parties"}
          </h1>
          <p className="text-sm text-slate-600">
            Upload a purchase register Excel file or manually add parties with
            their GSTIN numbers.
          </p>
        </motion.header>

        <PlanRestrictionBanner />

        {status.message ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow ${
              status.type === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {status.message}
          </div>
        ) : null}

        <motion.section
          className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur space-y-4"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2 className="text-lg font-semibold text-slate-900">
            Upload Purchase Register
          </h2>
          <p className="text-sm text-slate-600">
            Upload a .xls or .xlsx file. The system will extract party names
            from the "Particular" column and GSTIN/UIN from the "GSTIN/UIN"
            column. Headers should start from row 7 or 8.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="block text-sm text-slate-700 mb-2">
                Select Excel file
              </span>
              <input
                type="file"
                accept=".xls,.xlsx"
                onChange={handleFileChange}
                className="w-full rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                disabled={uploading || readOnly}
              />
              {uploadFile && (
                <p className="mt-1 text-xs text-slate-500">
                  Selected: {uploadFile.name}
                </p>
              )}
            </label>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!uploadFile || uploading || readOnly}
              className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600 disabled:opacity-60"
            >
              <FiUpload />
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </motion.section>

        <motion.section
          className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-lg backdrop-blur space-y-4"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <h2 className="text-lg font-semibold text-slate-900">
            Manually Add Party
          </h2>
          <form
            onSubmit={editingId ? handleUpdateParty : handleAddParty}
            className="flex flex-col gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                Party Name
                <input
                  type="text"
                  value={editingId ? editingValue.partyName : newParty.partyName}
                  onChange={(e) =>
                    editingId
                      ? setEditingValue({
                          ...editingValue,
                          partyName: e.target.value,
                        })
                      : setNewParty({ ...newParty, partyName: e.target.value })
                  }
                  className="mt-2 w-full rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="Enter party name"
                disabled={submitting || readOnly}
                />
              </label>
              <label className="text-sm text-slate-700">
                GSTIN/UIN
                <input
                  type="text"
                  value={editingId ? editingValue.gstin : newParty.gstin}
                  onChange={(e) =>
                    editingId
                      ? setEditingValue({
                          ...editingValue,
                          gstin: e.target.value,
                        })
                      : setNewParty({ ...newParty, gstin: e.target.value })
                  }
                  className="mt-2 w-full rounded-2xl border border-amber-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                  placeholder="Enter GSTIN/UIN"
                disabled={submitting || readOnly}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
              disabled={submitting || readOnly}
                className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-2 text-white text-sm font-semibold shadow hover:bg-amber-600 disabled:opacity-60"
              >
                {editingId ? <FiSave /> : <FiPlus />}
                {editingId ? "Save changes" : "Add party"}
              </button>
              {editingId ? (
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <FiX />
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </motion.section>

        <motion.section
          className="rounded-3xl border border-amber-100 bg-white/95 p-0 shadow-lg backdrop-blur"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
        >
          <header className="flex flex-col gap-3 border-b border-amber-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by party name or GSTIN..."
                  className="w-full rounded-xl border border-amber-200 bg-white pl-10 pr-4 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">
                {loading
                  ? "Loading..."
                  : searchTerm
                  ? `${filteredParties.length} of ${parties.length} parties`
                  : `${parties.length} parties`}
              </span>
              <button
                type="button"
                onClick={loadParties}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50"
              >
                <FiRefreshCw />
                Refresh
              </button>
            </div>
          </header>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-slate-500">
                <FiRefreshCw className="animate-spin text-lg" />
              </div>
            ) : filteredParties.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                {searchTerm
                  ? "No parties match your search."
                  : "No parties found. Upload a file or add one manually to get started."}
              </p>
            ) : (
              <table className="min-w-full divide-y divide-amber-50 text-sm text-slate-700">
                <thead className="bg-amber-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">
                      Party Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">
                      GSTIN/UIN
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredParties.map((party, index) => (
                    <tr
                      key={party._id}
                      className="border-b border-amber-50 last:border-none"
                    >
                      <td className="px-4 py-3 text-xs text-slate-400 w-16">
                        {index + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {party.partyName}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700">
                          {party.gstin}
                        </div>
                      </td>
                      <td className="px-4 py-3 w-40">
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => startEditing(party)}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                            disabled={submitting || readOnly}
                          >
                            <FiEdit2 />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                targetId: party._id,
                                targetName: party.partyName,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                            disabled={submitting || readOnly}
                          >
                            <FiTrash2 />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </motion.section>
      </section>
      <ConfirmDialog
        open={confirmState.open}
        title="Delete party?"
        message={`Are you sure you want to delete "${confirmState.targetName}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onCancel={() =>
          setConfirmState({ open: false, targetId: null, targetName: "" })
        }
        onConfirm={() => {
          const { targetId, targetName } = confirmState;
          setConfirmState({ open: false, targetId: null, targetName: "" });
          if (targetId && !readOnly) {
            handleDeleteParty(targetId, targetName);
          }
        }}
      />
    </motion.main>
  );
};

export default PartyMasterManager;

