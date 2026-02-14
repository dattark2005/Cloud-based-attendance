'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { motion } from 'framer-motion';
import { 
  Calendar, 
  Search, 
  MapPin, 
  Download, 
  Filter,
  ArrowUpDown,
  Clock,
  CheckCircle2
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api';
import { toast } from 'react-hot-toast';

export default function StudentHistory() {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetchWithAuth('/attendance/history');
        setHistory(res.data?.records || []);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load history');
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, []);

  const filteredHistory = history.filter(item => 
    item.lectureId?.sectionId?.courseId?.courseName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.status?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header & Filters */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Biometric Archive</h1>
            <p className="text-white/40 text-sm">Review your historical entry and exit patterns.</p>
          </div>
          <div className="flex items-center space-x-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
              <input 
                type="text" 
                placeholder="Search history..." 
                className="input-field pl-12 text-xs"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button className="p-3 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-all text-white/40">
              <Filter className="w-5 h-5" />
            </button>
            <button className="btn-primary p-3 px-6 rounded-2x flex items-center space-x-2 text-xs font-bold">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export PDF</span>
            </button>
          </div>
        </div>

        {/* Timeline Table */}
        <div className="glass-card rounded-[40px] border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
                  <th className="px-8 py-6">Timestamp & Date</th>
                  <th className="px-8 py-6">Activity Type</th>
                  <th className="px-8 py-6">Class/Location</th>
                  <th className="px-8 py-6">Confidence Score</th>
                  <th className="px-8 py-6 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  [1,2,3,4,5].map(i => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={5} className="px-8 py-8 h-20 bg-white/5" />
                    </tr>
                  ))
                ) : filteredHistory.length > 0 ? (
                  filteredHistory.map((log, i) => (
                    <motion.tr 
                      key={log._id || i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className="group hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-4">
                          <div className="p-3 bg-white/5 rounded-2xl border border-white/5 group-hover:border-primary/20">
                            <Calendar className="w-5 h-5 text-white/30 group-hover:text-primary transition-colors" />
                          </div>
                          <div>
                            <p className="font-bold text-sm tracking-tight">{new Date(log.markedAt).toLocaleDateString()}</p>
                            <p className="text-[10px] text-white/30">{new Date(log.markedAt).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className={`text-[10px] font-bold px-4 py-1.5 rounded-full border ${
                          log.status === 'PRESENT' 
                            ? 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5' 
                            : 'border-primary/20 text-primary bg-primary/5'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-2">
                          <MapPin className="w-4 h-4 text-white/20" />
                          <span className="text-sm font-medium text-white/80">
                            {log.lectureId?.sectionId?.courseId?.courseName || 'General Session'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center space-x-3">
                          <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(log.confidence || 0.85) * 100}%` }}
                              className="h-full bg-primary"
                            />
                          </div>
                          <span className="text-[10px] font-bold text-white/40">{Math.round((log.confidence || 0.85) * 100)}%</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button className="p-2 rounded-xl border border-white/5 hover:bg-white/5 transition-all">
                          <CheckCircle2 className="w-4 h-4 text-white/20" />
                        </button>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <div className="space-y-4 opacity-30">
                        <Clock className="w-12 h-12 mx-auto" />
                        <p className="text-sm italic">No history records found for your account.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination Controls */}
          <div className="px-8 py-6 border-t border-white/5 flex items-center justify-between">
            <p className="text-xs text-white/30">Showing <span className="text-white font-bold">{filteredHistory.length}</span> results</p>
            <div className="flex items-center space-x-2">
              <button disabled className="px-4 py-2 rounded-xl bg-white/5 text-xs font-bold opacity-50 cursor-not-allowed">Previous</button>
              <button disabled className="px-4 py-2 rounded-xl bg-white/5 text-xs font-bold opacity-50 cursor-not-allowed">Next</button>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
