import {
  estimatedDocumentCount,
  findAll as findAllGstin,
  insertMany as insertManyGstin,
} from "../models/gstinnumbermodel.js";

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    console.error("GSTINNumberController Error:", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "Something went wrong",
    });
  }
};

const seedData = [
  { stateName: "Jammu & Kashmir", gstCode: "01" },
  { stateName: "Himachal Pradesh", gstCode: "02" },
  { stateName: "Punjab", gstCode: "03" },
  { stateName: "Chandigarh", gstCode: "04" },
  { stateName: "Uttarakhand", gstCode: "05" },
  { stateName: "Haryana", gstCode: "06" },
  { stateName: "Delhi", gstCode: "07" },
  { stateName: "Rajasthan", gstCode: "08" },
  { stateName: "Uttar Pradesh", gstCode: "09" },
  { stateName: "Bihar", gstCode: "10" },
  { stateName: "Sikkim", gstCode: "11" },
  { stateName: "Arunachal Pradesh", gstCode: "12" },
  { stateName: "Nagaland", gstCode: "13" },
  { stateName: "Manipur", gstCode: "14" },
  { stateName: "Mizoram", gstCode: "15" },
  { stateName: "Tripura", gstCode: "16" },
  { stateName: "Meghalaya", gstCode: "17" },
  { stateName: "Assam", gstCode: "18" },
  { stateName: "West Bengal", gstCode: "19" },
  { stateName: "Jharkhand", gstCode: "20" },
  { stateName: "Odisha", gstCode: "21" },
  { stateName: "Chhattisgarh", gstCode: "22" },
  { stateName: "Madhya Pradesh", gstCode: "23" },
  { stateName: "Gujarat", gstCode: "24" },
  { stateName: "Daman & Diu", gstCode: "25" },
  { stateName: "Dadra & Nagar Haveli", gstCode: "26" },
  { stateName: "Maharashtra", gstCode: "27" },
  { stateName: "Andhra Pradesh (Old)", gstCode: "28" },
  { stateName: "Karnataka", gstCode: "29" },
  { stateName: "Goa", gstCode: "30" },
  { stateName: "Lakshadweep", gstCode: "31" },
  { stateName: "Kerala", gstCode: "32" },
  { stateName: "Tamil Nadu", gstCode: "33" },
  { stateName: "Puducherry", gstCode: "34" },
  { stateName: "Andaman & Nicobar Islands", gstCode: "35" },
  { stateName: "Telangana", gstCode: "36" },
  { stateName: "Andhra Pradesh (Newly Added)", gstCode: "37" },
  { stateName: "Ladakh (Newly Added)", gstCode: "38" },
  { stateName: "Others Territory", gstCode: "97" },
  { stateName: "Center Jurisdiction", gstCode: "99" },
];

export const ensureGSTINSeeded = async () => {
  const count = await estimatedDocumentCount();
  if (count === 0) {
    await insertManyGstin(seedData);
    console.log("Seeded GSTIN state codes");
  }
};

export const getGSTINNumbers = asyncHandler(async (_req, res) => {
  await ensureGSTINSeeded();
  const stateCodes = await findAllGstin();
  const sorted = [...stateCodes].sort((a, b) =>
    String(a?.gstCode || "").localeCompare(String(b?.gstCode || ""), undefined, {
      numeric: true,
    }),
  );
  res.json(sorted);
});

