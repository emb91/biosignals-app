'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getDisplayName } from '@/lib/auth-helpers';
import { toast, Toaster } from 'sonner';

interface ICP {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  company_sizes: string[];
  funding_stages: string[];
  created_at: string;
}

export default function ICPManagerPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const firstName = user ? getDisplayName(user) : '';

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
        const response = await fetch('/api/icp');
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
    if (!confirm('Are you sure you want to delete this ICP?')) return;

    setDeletingId(id);
    try {
      const response = await fetch(`/api/icp/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setIcps(icps.filter(icp => icp.id !== id));
        toast.success('ICP deleted successfully');
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
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top Bar */}
        <div className="bg-gray-50 px-6 py-3 flex-shrink-0">
          <div className="flex items-center justify-end">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {firstName}</span>
              <button
                onClick={async () => {
                  await logout();
                  router.push('/');
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
{/* Main Content */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="mb-6">
                <h1 className="text-xl font-bold text-gray-900 mb-2">
                  Define the companies you sell to
                </h1>
                <p className="text-sm text-gray-600">
                  Create as many as you like. Each company type helps us build targeted lead lists and craft personalized messaging for that segment.
                </p>
              </div>

              {/* ICP List or Empty State */}
              {icps.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 mb-6">
                    You haven't created any ICPs yet. Start by creating your first one.
                  </p>
                  <button
                    onClick={() => router.push('/icp/new')}
                    className="inline-flex items-center px-6 py-2 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                    Create New ICP
                  </button>
                </div>
              ) : (
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
                          <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => router.push(`/icp/${icp.id}/edit`)}
                              className="px-3 py-1.5 text-sm text-arcova-teal hover:bg-arcova-teal/10 rounded transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(icp.id)}
                              disabled={deletingId === icp.id}
                              className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            >
                              {deletingId === icp.id ? 'Deleting...' : 'Delete'}
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
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Create New Button */}
                  <button
                    onClick={() => router.push('/icp/new')}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-gray-500 hover:border-arcova-teal hover:text-arcova-teal transition-colors flex items-center justify-center"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                    Create New ICP
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}
