'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getCurrentUserToken } from '@/lib/auth-helpers';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [analyses, setAnalyses] = useState([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchAnalyses = async () => {
      if (!user) return;
      
      try {
        const idToken = await getCurrentUserToken();
        const response = await fetch('/api/user-analyses', {
          headers: {
            'Authorization': `Bearer ${idToken}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          setAnalyses(data.analyses || []);
        }
      } catch (error) {
        console.error('Error fetching analyses:', error);
      } finally {
        setLoadingAnalyses(false);
      }
    };

    fetchAnalyses();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-gray-50 px-6 py-4">
          <div className="flex items-center justify-end">
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">Welcome, {user.email}</span>
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
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Welcome to Your Dashboard
                </h2>
                <p className="text-lg text-gray-600 mb-8">
                  Your personalized overview of ICP configurations, data insights, and analytics.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Company Analyses</h3>
                    <p className="text-3xl font-bold text-blue-600">
                      {loadingAnalyses ? '...' : analyses.length}
                    </p>
                    <p className="text-sm text-blue-700">Companies analyzed</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-green-900 mb-2">Recent Activity</h3>
                    <p className="text-lg font-bold text-green-600">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? 'Active' : 'None'}
                    </p>
                    <p className="text-sm text-green-700">Latest analysis status</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-orange-900 mb-2">Last Analysis</h3>
                    <p className="text-lg font-bold text-orange-600">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? 'Recent' : 'Never'}
                    </p>
                    <p className="text-sm text-orange-700">Get started with new analysis</p>
                  </div>
                </div>

                {analyses.length > 0 && (
                  <div className="mt-12">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Recent Analyses</h3>
                      <div className="space-y-3">
                        {analyses.slice(0, 3).map((analysis: any, index: number) => (
                          <div key={analysis.id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium text-gray-900">{analysis.website || 'Unknown Website'}</p>
                              <p className="text-sm text-gray-500">
                                {analysis.analyzed_at ? new Date(analysis.analyzed_at.seconds * 1000).toLocaleDateString() : 'Unknown date'}
                              </p>
                            </div>
                            <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                              {analysis.status || 'Completed'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-12">
                  <div className="bg-gray-50 rounded-lg p-8">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">Get Started</h3>
                    <p className="text-gray-600 mb-6">
                      {analyses.length === 0 
                        ? 'Create your first company analysis to start generating insights.'
                        : 'Analyze another company to continue building your insights.'
                      }
                    </p>
                    <button
                      onClick={() => router.push('/about')}
                      className="bg-arcova-teal hover:bg-arcova-teal/90 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                    >
                      {analyses.length === 0 ? 'Start First Analysis' : 'Analyze New Company'}
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
