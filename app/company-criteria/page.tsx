'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import SetupShell from '@/components/SetupShell';
import { useSetupState } from '@/lib/use-setup-state';
import { toast, Toaster } from 'sonner';
import { getSignalDisplayName } from '@/lib/signal-display-names';

interface ICP {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  company_sizes: string[];
  funding_stages: string[];
  signals: string[];
  created_at: string;
}

export default function ICPManagerPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const setupState = useSetupState();
  const inSetup = !setupState.setupComplete;

  const [icps, setIcps] = useState<ICP[]>([]);
  const [loadingIcps, setLoadingIcps] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const loadICPs = async () => {
      if (!user) return;

      try {
        const response = await fetch('/api/company-criteria');
        if (response.ok) {
          const result = await response.json();
          setIcps(result.data || []);
        }
      } catch (error) {
        console.error('Error loading ICPs:', error);
      } finally {
        setLoadingIcps(false);
      }
    };

    if (user) {
      loadICPs();
    }
  }, [user]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this company profile? Any associated team will also be deleted.')) return;

    setDeletingId(id);
    try {
      const response = await fetch(`/api/company-criteria/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setIcps(icps.filter(icp => icp.id !== id));
        toast.success('Company profile and associated team deleted');
      } else {
        toast.error('Failed to delete ICP');
      }
    } catch (error) {
      console.error('Error deleting ICP:', error);
      toast.error('Failed to delete ICP');
    } finally {
      setDeletingId(null);
    }
  };

  const getICPSummary = (icp: ICP) => {
    const parts: string[] = [];
    
    if (icp.company_type) {
      parts.push(icp.company_type);
    }
    if (icp.therapeutic_areas?.length > 0) {
      parts.push(icp.therapeutic_areas[0]);
    }
    if (icp.funding_stages?.length > 0) {
      parts.push(icp.funding_stages[0]);
    }
    
    return parts.join(' · ') || 'No criteria set';
  };

  if (loading || loadingIcps) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <SetupShell inSetup={inSetup} step={2}>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Which companies do you sell to?</h1>
                <p className="text-gray-600 mt-1">Tell us about the companies you sell to. We&apos;ll use these to find and score the best accounts for you. Create as many as you like.</p>
              </div>
              {/* Continue button — only shown in setup mode once at least one ICP exists */}
              {inSetup && icps.length > 0 && (
                <button
                  onClick={() => router.push('/personas')}
                  className="shrink-0 px-5 py-2.5 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors text-sm"
                >
                  Next →
                </button>
              )}
            </div>

            {/* Main Content */}
            {icps.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No target company profiles yet</h3>
                <p className="text-gray-500 mb-6">Get started by defining your first target company type.</p>
                <button
                  onClick={() => router.push('/company-criteria/new')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  + Define new target company
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold text-gray-900">These are the companies you typically sell to</h2>
                </div>
                <div className="space-y-4">
                  {/* ICP Cards */}
                  {icps.map((icp) => (
                    <div
                      key={icp.id}
                      className={`border rounded-lg transition-all ${
                        expandedId === icp.id 
                          ? 'border-arcova-teal bg-arcova-teal/5' 
                          : 'border-gray-200 hover:border-arcova-teal/50'
                      }`}
                    >
                      {/* Card Header - Always Visible */}
                      <div 
                        className="p-4 cursor-pointer"
                        onClick={() => setExpandedId(expandedId === icp.id ? null : icp.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-900">
                                {icp.name || 'Unnamed ICP'}
                              </h3>
                              <svg 
                                className={`w-4 h-4 text-gray-400 transition-transform ${
                                  expandedId === icp.id ? 'rotate-180' : ''
                                }`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                            <p className="text-sm text-gray-500 mt-1">
                              {getICPSummary(icp)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/company-criteria/${icp.id}/edit`)}
                              className="p-2 text-arcova-teal hover:bg-arcova-teal/10 rounded transition-colors"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(icp.id)}
                              disabled={deletingId === icp.id}
                              className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedId === icp.id && (
                        <div className="px-4 pb-4 border-t border-gray-100">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
                            {/* Company Type */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Company Type
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.company_type ? (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                    {icp.company_type}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">Not specified</span>
                                )}
                              </div>
                            </div>

                            {/* Therapeutic Areas */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Therapeutic Area
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.therapeutic_areas?.length > 0 ? (
                                  icp.therapeutic_areas.map((area) => (
                                    <span key={area} className="px-2 py-1 bg-arcova-teal/10 text-arcova-teal rounded text-xs">
                                      {area}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Any</span>
                                )}
                              </div>
                            </div>

                            {/* Modalities */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Modality
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.modalities?.length > 0 ? (
                                  icp.modalities.map((mod) => (
                                    <span key={mod} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                                      {mod}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Any</span>
                                )}
                              </div>
                            </div>

                            {/* Development Stage */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Development Stage
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.development_stages?.length > 0 ? (
                                  icp.development_stages.map((stage) => (
                                    <span key={stage} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                                      {stage}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Any</span>
                                )}
                              </div>
                            </div>

                            {/* Company Size */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Company Size
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.company_sizes?.length > 0 ? (
                                  icp.company_sizes.map((size) => (
                                    <span key={size} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
                                      {size}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Any</span>
                                )}
                              </div>
                            </div>

                            {/* Funding Stages */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Funding Stage
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.funding_stages?.length > 0 ? (
                                  icp.funding_stages.map((stage) => (
                                    <span key={stage} className="px-2 py-1 bg-arcova-mint/30 text-arcova-darkblue rounded text-xs">
                                      {stage}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Any</span>
                                )}
                              </div>
                            </div>

                            {/* Signals */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                Signals
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {icp.signals?.length > 0 ? (
                                  icp.signals.map((signal) => (
                                    <span key={signal} className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                                      {getSignalDisplayName(signal)}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-gray-400">Not set</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Create New Button */}
                  <button
                    onClick={() => router.push('/company-criteria/new')}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-gray-500 hover:border-arcova-teal hover:text-arcova-teal transition-colors flex items-center justify-center"
                  >
                    + Define new target company
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </SetupShell>
  );
}
