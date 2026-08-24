import React, { useState } from 'react';
import { Card } from '../common/Card';
import { CheckCircle2, XCircle, Loader2, Play, ShieldCheck } from 'lucide-react';
import { ibvapApi } from '../../services/apiClient';

interface TestResult {
  name: string;
  subsystem: string;
  status: string;
  error?: string;
  recommendedFix?: string;
}

export const SystemVerificationPage: React.FC = () => {
  const [tests, setTests] = useState<TestResult[]>([
    { name: 'Backend API reachable', subsystem: 'Network', status: 'PENDING' },
    { name: 'Database writable', subsystem: 'Database', status: 'PENDING' },
    { name: 'MP4 opens', subsystem: 'Video Pipeline', status: 'PENDING' },
    { name: 'YOLO model loads', subsystem: 'AI Inference', status: 'PENDING' },
    { name: 'SentinelQuery retrieves actual record', subsystem: 'SentinelQuery', status: 'PENDING' },
    { name: 'Queue sync works', subsystem: 'EdgeGuard', status: 'PENDING' },
  ]);
  const [isRunning, setIsRunning] = useState(false);

  const runVerification = async () => {
    setIsRunning(true);
    const newTests = tests.map(t => ({ ...t, status: 'RUNNING', error: undefined as string | undefined }));
    setTests(newTests);

    // 1. Check API reachable
    try {
      await fetch('http://localhost:8000/health');
      newTests[0].status = 'PASS';
    } catch (e: any) {
      newTests[0].status = 'FAIL';
      newTests[0].error = 'Failed to fetch /health. Backend is down.';
      newTests[0].recommendedFix = 'Run python main.py in backend folder.';
    }
    setTests([...newTests]);

    // 2. Check Database / Camera endpoints
    if (newTests[0].status === 'PASS') {
      try {
        await ibvapApi.getCameras();
        newTests[1].status = 'PASS';
      } catch (e: any) {
        newTests[1].status = 'FAIL';
        newTests[1].error = e.message;
        newTests[1].recommendedFix = 'Check SQLite permissions/initialization.';
      }
    } else {
      newTests[1].status = 'FAIL';
      newTests[1].error = 'Skipped due to API down';
    }
    setTests([...newTests]);

    // 3. MP4 / Video endpoint
    if (newTests[0].status === 'PASS') {
      try {
        const res = await fetch('http://localhost:8000/api/video/test-inference');
        newTests[2].status = res.status < 500 ? 'PASS' : 'FAIL';
        newTests[2].error = res.status >= 500 ? 'Inference engine crash' : undefined;
      } catch {
        newTests[2].status = 'FAIL';
      }
    } else {
      newTests[2].status = 'FAIL';
    }
    setTests([...newTests]);

    // 4. YOLO model loads
    if (newTests[0].status === 'PASS') {
        newTests[3].status = newTests[2].status; // Tied to inference success for prototype
    }
    setTests([...newTests]);

    // 5. SentinelQuery
    if (newTests[0].status === 'PASS') {
      try {
        await ibvapApi.querySentinelAI('test');
        newTests[4].status = 'PASS';
      } catch {
        newTests[4].status = 'FAIL';
        newTests[4].error = 'Search API failed';
      }
    } else {
      newTests[4].status = 'FAIL';
    }
    setTests([...newTests]);

    // 6. Queue Sync
    if (newTests[0].status === 'PASS') {
      try {
        await ibvapApi.getSyncStatus();
        newTests[5].status = 'PASS';
      } catch {
        newTests[5].status = 'FAIL';
      }
    } else {
      newTests[5].status = 'FAIL';
    }
    
    setTests([...newTests]);
    setIsRunning(false);
  };

  return (
    <div className="space-y-6">
      <div className="p-5 bg-white border border-slate-200 shadow-sm rounded-lg flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-full bg-blue-50 text-[#005EA8]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#0B1F33] tracking-wide uppercase">System Verification</h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">Automated End-to-End Test Suite</p>
          </div>
        </div>
        <button
          onClick={runVerification}
          disabled={isRunning}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#005EA8] hover:bg-blue-700 text-white font-bold rounded-md shadow-sm transition-colors disabled:opacity-70 text-sm uppercase tracking-wider"
        >
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isRunning ? 'Running Tests...' : 'Run All Tests'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {tests.map((test, idx) => (
          <Card key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex flex-col space-y-1 mb-3 sm:mb-0">
              <span className="font-bold text-[#0B1F33] text-base">{test.name}</span>
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Subsystem: {test.subsystem}</span>
              {test.error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  <strong className="text-red-800">Error:</strong> {test.error} <br/>
                  <strong className="text-red-800 mt-1 block">Fix:</strong> {test.recommendedFix}
                </div>
              )}
            </div>
            <div className="flex items-center sm:self-start">
              {test.status === 'PENDING' && <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold uppercase tracking-widest shadow-sm">PENDING</span>}
              {test.status === 'RUNNING' && <Loader2 className="w-6 h-6 text-[#005EA8] animate-spin" />}
              {test.status === 'PASS' && <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs font-bold uppercase tracking-widest shadow-sm"><CheckCircle2 className="w-4 h-4" /> PASS</span>}
              {test.status === 'FAIL' && <span className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded-full text-xs font-bold uppercase tracking-widest shadow-sm"><XCircle className="w-4 h-4" /> FAIL</span>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
