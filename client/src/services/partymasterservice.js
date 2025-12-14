import axiosInstance from "../utils/axiosInstance";

const BASE_URL = "/api/party-masters";

export const fetchPartyMasters = (companyId) => {
  const url = companyId ? `${BASE_URL}?companyId=${companyId}` : BASE_URL;
  return axiosInstance.get(url);
};

export const fetchPartyMasterById = (id) =>
  axiosInstance.get(`${BASE_URL}/${id}`);

export const createPartyMaster = (payload) =>
  axiosInstance.post(BASE_URL, payload);

export const updatePartyMaster = (id, payload) =>
  axiosInstance.put(`${BASE_URL}/${id}`, payload);

export const deletePartyMaster = (id) =>
  axiosInstance.delete(`${BASE_URL}/${id}`);

export const uploadPurchaseRegister = (companyId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("companyId", companyId);
  return axiosInstance.post(`${BASE_URL}/upload`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

