import axiosInstance from "../utils/axiosInstance";

export const uploadGstr2ACSV = (file, payload = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  if (payload.companyId) {
    formData.append("companyId", payload.companyId);
  }
  if (payload.companySnapshot) {
    formData.append("companySnapshot", JSON.stringify(payload.companySnapshot));
  }

  return axiosInstance.post("/api/gstr2a-imports/csv", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const processGstr2AImport = (id) =>
  axiosInstance.post(`/api/gstr2a-imports/${id}/process`);

export const fetchProcessedFile = (id) =>
  axiosInstance.get(`/api/gstr2a-imports/${id}/processed`);

export const fetchImportsByCompany = (companyId) =>
  axiosInstance.get(`/api/gstr2a-imports/company/${companyId}`);

export const fetchImportById = (id) =>
  axiosInstance.get(`/api/gstr2a-imports/${id}`);

export const updateProcessedLedgerNames = (id, payload) =>
  axiosInstance.put(`/api/gstr2a-imports/${id}/processed/ledger-names`, payload);

export const updateReverseChargeLedgerNames = (id, payload) =>
  axiosInstance.put(`/api/gstr2a-imports/${id}/processed/reverse-charge/ledger-names`, payload);

export const updateMismatchedLedgerNames = (id, payload) =>
  axiosInstance.put(`/api/gstr2a-imports/${id}/processed/mismatched/ledger-names`, payload);

export const updateDisallowLedgerNames = (id, payload) =>
  axiosInstance.put(`/api/gstr2a-imports/${id}/processed/disallow/ledger-names`, payload);

export const deleteImport = (id) =>
  axiosInstance.delete(`/api/gstr2a-imports/${id}`);

export const appendManualRows = (id, payload) =>
  axiosInstance.post(`/api/gstr2a-imports/${id}/processed/manual-rows`, payload);

