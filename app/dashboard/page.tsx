'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppSidebar from '@/components/AppSidebar';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

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
                    <h3 className="text-lg font-semibold text-blue-900 mb-2">Active Configurations</h3>
                    <p className="text-3xl font-bold text-blue-600">0</p>
                    <p className="text-sm text-blue-700">ICP setups created</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-green-900 mb-2">Data Points</h3>
                    <p className="text-3xl font-bold text-green-600">0</p>
                    <p className="text-sm text-green-700">Records processed</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-orange-900 mb-2">Last Activity</h3>
                    <p className="text-lg font-bold text-orange-600">Never</p>
                    <p className="text-sm text-orange-700">Get started with Setup New</p>
                  </div>
                </div>

                <div className="mt-12">
                  <div className="bg-gray-50 rounded-lg p-8">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">Get Started</h3>
                    <p className="text-gray-600 mb-6">
                      Create your first ICP configuration to start analyzing your data and generating insights.
                    </p>
                    <button
                      onClick={() => router.push('/icp')}
                      className="bg-arcova-teal hover:bg-arcova-teal/90 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                    >
                      Setup New ICP
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
