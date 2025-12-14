import axiosInstance from "../utils/axiosInstance";

const BASE_URL = "/api/ledger-names";

export const fetchLedgerNames = () => axiosInstance.get(BASE_URL);

export const createLedgerName = (payload) =>
  axiosInstance.post(BASE_URL, payload);

export const updateLedgerName = (id, payload) =>
  axiosInstance.put(`${BASE_URL}/${id}`, payload);

export const deleteLedgerName = (id) =>
  axiosInstance.delete(`${BASE_URL}/${id}`);

