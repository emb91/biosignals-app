'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { getDisplayName } from '@/lib/utils';

export default function DashboardPage() {
  const { user, firstName, loading, logout } = useAuth();
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
        console.log('Fetching analyses for user:', user.uid);
        
        // Query Firestore directly from client
        const analysesRef = collection(db, 'company_analyses');
        const q = query(
          analysesRef,
          where('user_id', '==', user.uid)
        );

        const querySnapshot = await getDocs(q);
        const analysesData = querySnapshot.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
          .sort((a: any, b: any) => {
            // Sort by analyzed_at in descending order (most recent first)
            const aTime = a.analyzed_at?.seconds || 0;
            const bTime = b.analyzed_at?.seconds || 0;
            return bTime - aTime;
          });

        console.log('Fetched analyses:', analysesData);
        setAnalyses(analysesData as any);
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
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Welcome to Your Dashboard
                </h2>
                <p className="text-lg text-gray-600 mb-8">
                  Your personalized overview of ICP configurations, data insights, and analytics.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
                  <button
                    onClick={() => router.push('/about')}
                    className="bg-blue-50 rounded-lg p-6 hover:bg-blue-100 transition-colors text-left"
                  >
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Your Company Analysis</h3>
                    <p className="text-2xl font-bold text-blue-600 truncate">
                      {loadingAnalyses ? '...' : analyses.length > 0 ? (analyses[0]?.company_name || analyses[0]?.domain || 'Your Company') : 'Not started'}
                    </p>
                    <p className="text-sm text-blue-700">
                      {analyses.length > 0 ? 'Click to view or edit' : 'Click to get started'}
                    </p>
                  </button>
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
                      <h3 className="text-xl font-semibold text-gray-900 mb-4">Recent Activity</h3>
                      <div className="space-y-3">
                        {analyses.slice(0, 3).map((analysis: any, index: number) => {
                          const activityDate = analysis.analyzed_at 
                            ? new Date(analysis.analyzed_at.seconds * 1000)
                            : new Date();
                          
                          const isToday = activityDate.toDateString() === new Date().toDateString();
                          const dateDisplay = isToday 
                            ? `Today at ${activityDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : activityDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

                          return (
                            <div key={analysis.id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div>
                                <p className="font-medium text-gray-900">
                                  {analysis.company_name || analysis.domain || 'Your Company'}
                                </p>
                                <p className="text-sm text-gray-500">
                                  {dateDisplay}
                                </p>
                              </div>
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                                {analysis.status || 'Completed'}
                              </span>
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
                      onClick={() => router.push(analyses.length === 0 ? '/about' : '/icp')}
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
