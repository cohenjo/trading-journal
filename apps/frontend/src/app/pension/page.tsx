'use client';
export const dynamic = 'force-dynamic';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import PensionChart from '@/components/Pension/PensionChart';
import PensionTable from '@/components/Pension/PensionTable';
import ReportHistory from '@/components/Pension/ReportHistory';
import SnapshotDetail from '@/components/Pension/SnapshotDetail';
import { deletePensionReport, getPensionDashboard, listPensionReports, uploadPensionPdf } from './actions';
import { subscribeToComputeJob, type ComputeJob } from '@/lib/compute-jobs-client';
import type { PensionAccount, PensionDashboardResponse, PensionSeriesPoint, PensionSnapshotSummary } from '@/components/Pension/pensionTypes';

interface PensionUploadJobResult {
    status: string;
    result?: Record<string, string | number | null | undefined>;
    analysis_result?: Record<string, string | number | null | undefined>;
    snapshot_updated?: boolean;
    latest_snapshot_updated?: boolean;
    plan_updated?: boolean;
    inserted_rows?: number;
    snapshot_dates?: string[];
}

type UploadStatus = 'idle' | 'uploading' | 'parsing' | 'done' | 'failed';

const formatUploadNumber = (value: string | number | null | undefined) => {
    if (typeof value === 'number') return new Intl.NumberFormat().format(value);
    if (typeof value === 'string' && value.trim()) return value;
    return 'N/A';
};

const formatUploadText = (...values: Array<string | number | null | undefined>) =>
    values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? 'N/A';

const toChartPoints = (points: PensionSeriesPoint[]) => points.map((point) => {
    const chartPoint: { date: string; [key: string]: string | number } = { date: point.date };
    for (const [key, value] of Object.entries(point)) {
        if (key !== 'date' && value !== undefined) chartPoint[key] = value;
    }
    return chartPoint;
});

const toChartAccounts = (accounts: PensionAccount[]) => accounts.map((account) => ({
    id: account.id,
    series_id: account.series_id,
    owner: account.owner,
    name: account.name,
}));

const toTableAccounts = (accounts: PensionAccount[]) => accounts.map((account) => ({
    id: account.id,
    owner: account.owner,
    name: account.name,
    value: account.value,
    details: account.details ?? {},
}));

export default function PensionPage() {
    const [owner, setOwner] = useState('You');
    const [file, setFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
    const [jobId, setJobId] = useState<string | null>(null);
    const [storagePath, setStoragePath] = useState<string | null>(null);
    const [result, setResult] = useState<PensionUploadJobResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dashboardData, setDashboardData] = useState<PensionDashboardResponse | null>(null);
    const [selectedSnapshot, setSelectedSnapshot] = useState<PensionSnapshotSummary | null>(null);
    const [previousSnapshot, setPreviousSnapshot] = useState<PensionSnapshotSummary | null>(null);
    const [allSnapshots, setAllSnapshots] = useState<PensionSnapshotSummary[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const loading = uploadStatus === 'uploading' || uploadStatus === 'parsing';

    const fetchDashboard = async () => {
        try {
            const data = await getPensionDashboard();
            if (data.status === 'success') {
                setDashboardData(data);
            }
        } catch (err) {
            console.error("Failed to load dashboard data:", err);
        }
    };

    useEffect(() => {
        fetchDashboard();
    }, []);

    const handleSelectSnapshot = useCallback((snapshot: PensionSnapshotSummary | null) => {
        setSelectedSnapshot(snapshot);
        if (snapshot && allSnapshots.length > 0) {
            const idx = allSnapshots.findIndex((s) => s.date === snapshot.date);
            setPreviousSnapshot(idx > 0 ? allSnapshots[idx - 1] : null);
        } else {
            setPreviousSnapshot(null);
        }
    }, [allSnapshots]);

    // Keep allSnapshots in sync by fetching from reports Server Action.
    useEffect(() => {
        listPensionReports()
            .then((json) => {
                if (json.snapshots) {
                    setAllSnapshots(json.snapshots);
                }
            })
            .catch(() => {});
    }, [refreshKey]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setFile(e.dataTransfer.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const handleJobUpdate = useCallback(async (job: ComputeJob) => {
        if (job.status === 'running' || job.status === 'pending') {
            setUploadStatus('parsing');
            return;
        }
        if (job.status === 'failed') {
            setUploadStatus('failed');
            setError(job.error ?? 'Pension parser failed.');
            return;
        }
        if (job.status === 'done') {
            setUploadStatus('done');
            setResult(job.result as PensionUploadJobResult);
            await fetchDashboard();
            setRefreshKey((k) => k + 1);
        }
    }, []);

    useEffect(() => {
        if (!jobId) return undefined;
        return subscribeToComputeJob(jobId, (job) => {
            void handleJobUpdate(job);
        });
    }, [handleJobUpdate, jobId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!file) {
            setError('Please select a file to upload.');
            return;
        }

        setUploadStatus('uploading');
        setError(null);
        setResult(null);
        setJobId(null);
        setStoragePath(null);

        try {
            const data = await uploadPensionPdf(file, owner);
            setJobId(data.jobId);
            setStoragePath(data.storagePath);
            setUploadStatus('parsing');
        } catch (err: unknown) {
            console.error(err);
            setUploadStatus('failed');
            setError(err instanceof Error ? err.message : 'An error occurred during upload.');
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to delete "${name}"?`)) {
            return;
        }

        try {
            const res = await deletePensionReport(id);
            if (res.ok) {
                await fetchDashboard();
                setRefreshKey((k) => k + 1);
            } else {
                console.error("Failed to delete pension item", res.error);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const extractedResult = result?.analysis_result ?? result?.result ?? {};

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 pb-24">
            <div className="max-w-7xl mx-auto space-y-8">
                <header>
                    <h1 className="text-2xl font-bold text-white">Pension Dashboard</h1>
                    <p className="text-slate-400 mt-2">
                        Track the historical growth of your pension accounts and project future values towards retirement.
                    </p>
                </header>

                {/* Dashboard Visualization */}
                {dashboardData && dashboardData.history && dashboardData.history.length > 0 && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <PensionChart
                            history={toChartPoints(dashboardData.history)}
                            projections={toChartPoints(dashboardData.projections)}
                            accounts={toChartAccounts(dashboardData.accounts)}
                            milestones={dashboardData.milestones}
                        />
                        <PensionTable accounts={toTableAccounts(dashboardData.accounts)} onDelete={handleDelete} />
                    </div>
                )}

                {/* Historical Snapshot Detail */}
                {selectedSnapshot && (
                    <SnapshotDetail
                        snapshot={selectedSnapshot}
                        previousSnapshot={previousSnapshot}
                        onClose={() => handleSelectSnapshot(null)}
                    />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Report History Panel */}
                    <div className="lg:col-span-1 lg:order-last">
                        <ReportHistory
                            onSelectSnapshot={handleSelectSnapshot}
                            selectedDate={selectedSnapshot?.date ?? null}
                            refreshKey={refreshKey}
                        />
                    </div>

                    <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Upload Form */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                        <h2 className="text-xl font-semibold mb-4 text-white">Upload Report</h2>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-2">Account Owner</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="owner"
                                            value="You"
                                            checked={owner === 'You'}
                                            onChange={() => setOwner('You')}
                                            className="form-radio text-blue-500 focus:ring-blue-500 bg-slate-800 border-slate-700 h-4 w-4"
                                        />
                                        <span className="text-slate-200">You</span>
                                    </label>
                                    <label className="flex items-center space-x-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="owner"
                                            value="Rita"
                                            checked={owner === 'Rita'}
                                            onChange={() => setOwner('Rita')}
                                            className="form-radio text-blue-500 focus:ring-blue-500 bg-slate-800 border-slate-700 h-4 w-4"
                                        />
                                        <span className="text-slate-200">Rita</span>
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-2">PDF Report</label>

                                <div
                                    className={`border-2 border-dashed ${file ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'} rounded-lg p-8 text-center cursor-pointer transition-colors`}
                                    onDrop={handleDrop}
                                    onDragOver={handleDragOver}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <input
                                        title="Upload PDF"
                                        aria-label="Upload PDF Report"
                                        type="file"
                                        ref={fileInputRef}
                                        className="hidden"
                                        accept=".pdf"
                                        onChange={handleFileChange}
                                    />

                                    {file ? (
                                        <div className="flex flex-col items-center">
                                            <svg className="w-8 h-8 text-blue-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            <span className="text-sm text-slate-200 font-medium">{file.name}</span>
                                            <span className="text-xs text-slate-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center">
                                            <svg className="w-10 h-10 text-slate-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                            </svg>
                                            <span className="text-sm text-slate-300">Click or drag PDF file here to upload</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-sm">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={!file || loading}
                                className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${!file || loading
                                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                                    }`}
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center">
                                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        {uploadStatus === 'uploading' ? 'Uploading PDF...' : 'Parsing PDF...'}
                                    </span>
                                ) : 'Upload and Parse'}
                            </button>
                        </form>
                    </div>

                    {/* Results Display */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 h-fit bg-opacity-50">
                        <h2 className="text-xl font-semibold mb-4 text-white">Analysis Result</h2>

                        {!result && !loading && (
                            <div className="text-slate-500 text-sm italic">
                                Upload a report to see the extracted data and update status here.
                            </div>
                        )}

                        {loading && (
                            <div className="space-y-2">
                                <div className="text-slate-400 text-sm flex items-center space-x-2 animate-pulse">
                                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animation-delay-200"></div>
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animation-delay-400"></div>
                                    <span>{uploadStatus === 'uploading' ? 'Uploading to private Storage...' : 'Worker is parsing the PDF...'}</span>
                                </div>
                                {(jobId || storagePath) && (
                                    <div className="text-xs text-slate-500 break-all">
                                        {jobId && <div>Job: {jobId}</div>}
                                        {storagePath && <div>Storage path: {storagePath}</div>}
                                    </div>
                                )}
                            </div>
                        )}

                        {result && result.status === 'success' && (
                            <div className="space-y-6">
                                <div className="flex items-center space-x-2 text-green-400 bg-green-400/10 p-3 rounded-lg border border-green-400/20">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    <span className="font-medium">Successfully processed</span>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Extracted Data</h3>

                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="col-span-2">
                                            <span className="block text-slate-500">Pension Fund Name</span>
                                            <span className="block text-slate-200 font-medium">{formatUploadText(extractedResult['Pension Fund Name'], extractedResult['Name'])}</span>
                                        </div>

                                        <div>
                                            <span className="block text-slate-500">Total Amount</span>
                                            <span className="block text-slate-200 font-medium">
                                                {formatUploadNumber(extractedResult['Total Amount'])}
                                            </span>
                                        </div>

                                        <div>
                                            <span className="block text-slate-500">Deposits</span>
                                            <span className="block text-slate-200 font-medium">
                                                {formatUploadNumber(extractedResult['Deposits'] ?? extractedResult['Monthly Deposits'])}
                                            </span>
                                        </div>

                                        <div>
                                            <span className="block text-slate-500">Earnings</span>
                                            <span className="block text-slate-200 font-medium">
                                                {formatUploadNumber(extractedResult['Earnings'])}
                                            </span>
                                        </div>

                                        <div>
                                            <span className="block text-slate-500">Fees</span>
                                            <span className="block text-slate-200 font-medium">
                                                {formatUploadNumber(extractedResult['Fees'])}
                                            </span>
                                        </div>

                                        <div>
                                            <span className="block text-slate-500">Insurance Fees</span>
                                            <span className="block text-slate-200 font-medium">
                                                {formatUploadNumber(extractedResult['Insurance Fees'])}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-800">
                                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">System Updates</h3>
                                    <ul className="space-y-2 text-sm">
                                        <li className="flex items-start space-x-2">
                                            {result.snapshot_updated ? (
                                                <svg className="w-4 h-4 text-green-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            ) : (
                                                <svg className="w-4 h-4 text-slate-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            )}
                                            <span className={result.snapshot_updated ? 'text-slate-300' : 'text-slate-500'}>
                                                {result.snapshot_updated ? 'Updated Current Finances Snapshot' : 'No Snapshot Update Needed'}
                                            </span>
                                        </li>
                                        <li className="flex items-start space-x-2">
                                            {result.plan_updated ? (
                                                <svg className="w-4 h-4 text-green-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                            ) : (
                                                <svg className="w-4 h-4 text-slate-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            )}
                                            <span className={result.plan_updated ? 'text-slate-300' : 'text-slate-500'}>
                                                {result.plan_updated ? 'Updated Long-Term Financial Plan' : 'No Plan Update Needed'}
                                            </span>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
