"use client";

import React from "react";

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title?: string;
    message?: string;
    isDeleting?: boolean;
}

export default function DeleteConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title = "Delete Position",
    message = "Are you sure you want to delete this position? This action cannot be undone.",
    isDeleting = false
}: DeleteConfirmationModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex justify-center items-center z-50">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md shadow-2xl transform transition-all">
                <h2 className="text-xl font-bold text-white mb-2">{title}</h2>
                <p className="text-slate-400 mb-6">{message}</p>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors font-medium"
                        disabled={isDeleting}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-medium flex items-center gap-2"
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <>
                                <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                                Deleting...
                            </>
                        ) : (
                            "Delete"
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
