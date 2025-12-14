import { useEffect, useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";

const LedgerNameDropdown = ({
  value = "",
  options = [],
  onChange,
  placeholder = "Select or type ledger",
  onAddNew,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState(options);
  const [inputValue, setInputValue] = useState(value);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const filter = inputValue.toLowerCase().trim();
    if (!filter) {
      setFilteredOptions(options);
    } else {
      setFilteredOptions(
        options.filter((opt) =>
          String(opt.name || opt).toLowerCase().includes(filter)
        )
      );
    }
  }, [inputValue, options]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleInputChange = (event) => {
    const newValue = event.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    onChange?.(newValue);
  };

  const handleSelectOption = (optionValue) => {
    setInputValue(optionValue);
    setIsOpen(false);
    onChange?.(optionValue);
    inputRef.current?.focus();
  };

  const handleInputFocus = () => {
    setIsOpen(true);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (event.key === "Enter" && filteredOptions.length === 1) {
      event.preventDefault();
      handleSelectOption(
        filteredOptions[0]?.name || filteredOptions[0] || inputValue
      );
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className="w-56 rounded-xl border border-amber-200 bg-white px-3 py-1 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-amber-200"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
        >
          <FiChevronDown
            className={`h-4 w-4 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-56 rounded-xl border border-amber-200 bg-white shadow-lg">
          <div
            ref={listRef}
            className="max-h-60 overflow-y-auto overscroll-contain"
          >
            {filteredOptions.length > 0 ? (
              <ul className="py-1">
                {filteredOptions.map((option, idx) => {
                  const optionValue = option?.name || option;
                  const optionId = option?._id || idx;
                  return (
                    <li
                      key={optionId}
                      onClick={() => handleSelectOption(optionValue)}
                      className="cursor-pointer px-3 py-2 text-xs text-slate-700 hover:bg-amber-50 active:bg-amber-100"
                    >
                      {optionValue}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-3 py-2 text-xs text-slate-500">
                No matches found
              </div>
            )}
            {onAddNew && inputValue.trim() && (
              <div className="border-t border-amber-100">
                <button
                  type="button"
                  onClick={() => {
                    onAddNew(inputValue.trim());
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs font-semibold text-amber-600 hover:bg-amber-50 active:bg-amber-100"
                >
                  + Add "{inputValue.trim()}"
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LedgerNameDropdown;

