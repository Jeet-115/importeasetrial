import axiosInstance from "../utils/axiosInstance";

const BASE_URL = "/api/company-master";

export const fetchCompanyMasters = () => axiosInstance.get(BASE_URL);

export const fetchCompanyMasterById = (id) =>
  axiosInstance.get(`${BASE_URL}/${id}`);

export const createCompanyMaster = (payload) =>
  axiosInstance.post(BASE_URL, payload);

export const updateCompanyMaster = (id, payload) =>
  axiosInstance.put(`${BASE_URL}/${id}`, payload);

export const deleteCompanyMaster = (id) =>
  axiosInstance.delete(`${BASE_URL}/${id}`);

