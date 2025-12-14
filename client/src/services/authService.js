import axiosInstance from "../utils/axiosInstance.js";

export const loginSoftware = async ({ email, password, deviceId }) => {
  try {
    const response = await axiosInstance.post("/software/login", {
      email,
      password,
      deviceId,
    });
    return response.data;
  } catch (error) {
    // Return error response data if available, otherwise throw
    if (error.response?.data) {
      return error.response.data;
    }
    throw error;
  }
};


