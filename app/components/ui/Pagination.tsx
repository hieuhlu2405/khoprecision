"use client";

import React from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage = 50,
}) => {
  // Prevent rendering if there's visually no pagination needed, 
  // though it's still good to show "1 of 1" sometimes.
  if (totalPages <= 1 && !totalItems) return null;

  const handlePrev = () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  };

  // Logic to show a window of pages (e.g., 1, 2, 3, ..., 10)
  const renderPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = startPage + maxVisible - 1;

    if (endPage > totalPages) {
      endPage = totalPages;
      startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
      pages.push(
        <button key="1" onClick={() => onPageChange(1)} className="btn btn-ghost btn-sm font-mono font-medium rounded-lg px-3">
          1
        </button>
      );
      if (startPage > 2) {
        pages.push(<span key="dots1" className="text-slate-400 px-2">...</span>);
      }
    }

    for (let i = startPage; i <= endPage; i++) {
        pages.push(
            <button
              key={i}
              onClick={() => onPageChange(i)}
              className={`btn btn-sm font-mono font-bold rounded-xl px-4 transition-all duration-300 ${
                currentPage === i
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-200 border-none hover:bg-indigo-700"
                  : "btn-ghost text-slate-600 hover:bg-slate-100"
              }`}
            >
              {i}
            </button>
        );
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push(<span key="dots2" className="text-slate-400 px-2">...</span>);
      }
      pages.push(
        <button key={totalPages} onClick={() => onPageChange(totalPages)} className="btn btn-ghost btn-sm font-mono font-medium rounded-lg px-3">
          {totalPages}
        </button>
      );
    }

    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between py-4 px-6 bg-white/50 backdrop-blur-md rounded-2xl border border-white/40 shadow-sm mt-4 gap-4">
      <div className="text-xs font-black uppercase tracking-widest text-slate-500">
        {totalItems !== undefined ? (
          <span>
            ĐANG Xem <span className="text-indigo-600">{(currentPage - 1) * itemsPerPage + 1}</span> -{" "}
            <span className="text-indigo-600">{Math.min(currentPage * itemsPerPage, totalItems)}</span> /{" "}
            <span className="text-slate-800">{totalItems}</span> Bản ghi
          </span>
        ) : (
          <span>Trang {currentPage} / {totalPages}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handlePrev}
          disabled={currentPage === 1}
          className="btn btn-ghost btn-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-500 rounded-xl px-3 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          <span className="hidden sm:inline-block ml-1 text-[11px] font-black uppercase tracking-widest">Trang trước</span>
        </button>
        
        <div className="flex items-center gap-1 bg-slate-50/80 p-1 rounded-2xl border border-slate-100">
          {renderPageNumbers()}
        </div>

        <button
          onClick={handleNext}
          disabled={currentPage === totalPages || totalPages === 0}
          className="btn btn-ghost btn-sm text-slate-500 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-500 rounded-xl px-3 transition-colors"
        >
          <span className="hidden sm:inline-block mr-1 text-[11px] font-black uppercase tracking-widest">Trang sau</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>
    </div>
  );
};
