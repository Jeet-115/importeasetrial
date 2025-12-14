import { AnimatePresence, motion } from "framer-motion";

const ExcelPreviewModal = ({
  open,
  title,
  columns = [],
  rows = [],
  onClose,
}) => (
  <AnimatePresence>
    {open ? (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-5xl max-h-[80vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700 text-sm"
            >
              Close
            </button>
          </header>
          <div className="overflow-auto px-6 py-4">
            <table className="min-w-full text-xs text-slate-700">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-2 py-2 text-left font-semibold border-b border-slate-100"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-50">
                      {columns.map((col) => (
                        <td key={col} className="px-2 py-2">
                          {row?.[col] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={columns.length || 1}
                      className="text-center py-6 text-slate-400"
                    >
                      No data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);

export default ExcelPreviewModal;

