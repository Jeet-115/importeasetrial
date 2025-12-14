import {
  create as createCompanyMasterRecord,
  findAll as findAllCompanies,
  findById as findCompanyById,
  updateById as updateCompanyById,
  deleteById as deleteCompanyById,
} from "../models/companymastermodel.js";

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error("CompanyMasterController Error:", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "Something went wrong",
    });
  }
};

export const createCompanyMaster = asyncHandler(async (req, res) => {
  const company = await createCompanyMasterRecord(req.body);
  res.status(201).json(company);
});

export const getCompanyMasters = asyncHandler(async (_req, res) => {
  const companies = await findAllCompanies();
  const sorted = [...companies].sort(
    (a, b) =>
      new Date(b?.createdAt || 0).getTime() -
      new Date(a?.createdAt || 0).getTime(),
  );
  res.json(sorted);
});

export const getCompanyMasterById = asyncHandler(async (req, res) => {
  const company = await findCompanyById(req.params.id);

  if (!company) {
    return res.status(404).json({ message: "Company master not found" });
  }

  res.json(company);
});

export const updateCompanyMaster = asyncHandler(async (req, res) => {
  const company = await updateCompanyById(req.params.id, req.body);

  if (!company) {
    return res.status(404).json({ message: "Company master not found" });
  }

  res.json(company);
});

export const deleteCompanyMaster = asyncHandler(async (req, res) => {
  const deleted = await deleteCompanyById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ message: "Company master not found" });
  }

  res.json({ message: "Company master deleted successfully" });
});

