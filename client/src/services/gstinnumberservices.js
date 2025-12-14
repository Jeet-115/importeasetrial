import axiosInstance from "../utils/axiosInstance";

const BASE_URL = "/api/gstin-numbers";

export const fetchGSTINNumbers = () => axiosInstance.get(BASE_URL);

