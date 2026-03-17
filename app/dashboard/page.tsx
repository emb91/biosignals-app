'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/lib/supabase';
import { getDisplayName } from '@/lib/auth-helpers';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [icps, setIcps] = useState<any[]>([]);
  const [loadingIcps, setLoadingIcps] = useState(true);

  const firstName = user ? getDisplayName(user) : '';

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchAnalyses = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('company_analyses')
          .select('*')
          .eq('user_id', user.id)
          .order('analyzed_at', { ascending: false });

        if (error) throw error;
        setAnalyses(data || []);
      } catch (error) {
        console.error('Error fetching analyses:', error);
      } finally {
        setLoadingAnalyses(false);
      }
    };

    const fetchIcps = async () => {
      if (!user) return;
      
      try {
        const response = await fetch('/api/icp');
        if (response.ok) {
          const result = await response.json();
          setIcps(result.data || []);
        }
      } catch (error) {
        console.error('Error fetching ICPs:', error);
      } finally {
        setLoadingIcps(false);
      }
    };

    fetchAnalyses();
    fetchIcps();
  }, [user]);

  if (loading) {
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
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-gray-50 px-6 py-4">
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
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Welcome to Your Dashboard
                </h2>
                <p className="text-lg text-gray-600 mb-8">
                  Your personalized overview of ICP configurations, data insights, and analytics.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <button
                    onClick={() => router.push('/company-analysis')}
                    className="bg-arcova-teal/10 rounded-lg p-6 hover:bg-arcova-teal/20 transition-colors text-left"
                  >
                    <h3 className="text-lg font-semibold text-arcova-darkblue mb-2">Your Company</h3>
                    <p className="text-lg font-bold text-arcova-blue truncate">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? (analyses[0]?.company_name || analyses[0]?.domain || 'Your Company') : 'Not started'}
                    </p>
                    <p className="text-sm text-arcova-blue">
                      {analyses.length > 0 ? 'Click to view or edit' : 'Click to get started'}
                    </p>
                  </button>

                  <div className="bg-arcova-mint/20 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-arcova-darkblue mb-2">Recent Activity</h3>
                    <p className="text-lg font-bold text-arcova-blue">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? 'Active' : 'None'}
                    </p>
                    <p className="text-sm text-arcova-darkblue/70">Latest analysis status</p>
                  </div>

                  <div className="bg-arcova-beige/30 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-arcova-darkblue mb-2">Last Analysis</h3>
                    <p className="text-lg font-bold text-arcova-blue">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? 'Recent' : 'Never'}
                    </p>
                    <p className="text-sm text-arcova-darkblue/70">Get started with new analysis</p>
                  </div>
                </div>

                {/* Your ICPs Section */}
                <div className="mt-8">
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold text-gray-900 text-left">Your ICPs</h3>
                      <button
                        onClick={() => router.push('/icp')}
                        className="text-sm text-arcova-teal hover:text-arcova-teal/80"
                      >
                        Manage ICPs →
                      </button>
                    </div>
                    
                    {loadingIcps ? (
                      <p className="text-gray-500 text-sm">Loading...</p>
                    ) : icps.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-gray-500 text-sm mb-3">No ICPs created yet</p>
                        <button
                          onClick={() => router.push('/icp/new')}
                          className="text-sm text-arcova-teal hover:underline"
                        >
                          + Create your first ICP
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {icps.slice(0, 3).map((icp) => (
                          <button
                            key={icp.id}
                            onClick={() => router.push('/icp')}
                            className="w-full flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-arcova-teal/5 transition-colors text-left"
                          >
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{icp.name || 'Unnamed ICP'}</p>
                              <p className="text-xs text-gray-500">
                                {[
                                  icp.company_type,
                                  icp.therapeutic_areas?.[0],
                                  icp.funding_stages?.[0]
                                ].filter(Boolean).join(' · ') || 'No criteria set'}
                              </p>
                            </div>
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        ))}
                        {icps.length > 3 && (
                          <p className="text-xs text-gray-500 text-center pt-2">
                            +{icps.length - 3} more ICPs
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {analyses.length > 0 && (
                  <div className="mt-8">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h3 className="text-xl font-semibold text-gray-900 mb-4 text-left">Recent Activity</h3>
                      <div className="space-y-3">
                        {analyses.slice(0, 3).map((analysis, index) => {
                          const activityDate = analysis.analyzed_at 
                            ? new Date(analysis.analyzed_at)
                            : new Date();
                          
                          const isToday = activityDate.toDateString() === new Date().toDateString();
                          const dateDisplay = isToday 
                            ? `Today at ${activityDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : activityDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

                          return (
                            <div key={analysis.id || index} className="grid grid-cols-3 items-center p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                              <p>
                                {analysis.company_name || analysis.domain || 'Your Company'} company details summarized
                              </p>
                              <p className="text-center">
                                {dateDisplay}
                              </p>
                              <div className="text-right">
                                <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full">
                                  Completed
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-12">
                  <div className="bg-gray-50 rounded-lg p-8">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">
                      {analyses.length === 0 ? 'Get Started' : 'Next Step'}
                    </h3>
                    <p className="text-gray-600 mb-6">
                      {analyses.length === 0 
                        ? 'Create your first company analysis to start generating insights.'
                        : 'Define your Ideal Customer Profile (ICP) to start finding the right leads.'
                      }
                    </p>
                    <button
                      onClick={() => router.push(analyses.length === 0 ? '/company-analysis' : '/icp')}
                      className="bg-arcova-teal hover:bg-arcova-teal/90 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                    >
                      {analyses.length === 0 ? 'Start Company Analysis' : 'Setup Your ICP'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
