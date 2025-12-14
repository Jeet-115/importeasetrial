export const sanitizeFileName = (value) =>
  (value || "company")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

