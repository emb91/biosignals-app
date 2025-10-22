'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getDisplayName } from '@/lib/utils';

export default function ICPPage() {
  const { user, firstName, loading, logout } = useAuth();
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
          <div className="max-w-4xl mx-auto">
            {/* Progress Indicator */}
            <div className="mb-8">
              <div className="flex items-center justify-center space-x-8">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-arcova-teal rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-semibold">1</span>
                  </div>
                  <span className="ml-2 text-arcova-teal font-semibold">ICP (Ideal Customer Profile)</span>
                </div>
                <div className="w-16 h-0.5 bg-gray-300"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-semibold">2</span>
                  </div>
                  <span className="ml-2 text-gray-500">Signals (Intent Signals)</span>
                </div>
                <div className="w-16 h-0.5 bg-gray-300"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-semibold">3</span>
                  </div>
                  <span className="ml-2 text-gray-500">Leads (Leads Management)</span>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Define Your Ideal Customer Profile
                </h2>
                <p className="text-gray-600">
                  Configure who your AI agent should target when searching for leads.
                </p>
              </div>

              <form className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column */}
                  <div className="space-y-6">
                    {/* Target Job Titles */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Job Titles
                      </label>
                      <div className="flex">
                        <input
                          type="text"
                          placeholder="e.g., Sales Manager"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                        />
                        <button
                          type="button"
                          className="px-4 py-2 bg-arcova-teal text-white rounded-r-lg hover:bg-arcova-teal/90 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Target Industries */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Industries
                      </label>
                      <div className="relative">
                        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none">
                          <option>Select industries...</option>
                          <option>Technology</option>
                          <option>Healthcare</option>
                          <option>Finance</option>
                          <option>Manufacturing</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Company Sizes */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Sizes
                      </label>
                      <div className="relative">
                        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none">
                          <option>Select company sizes...</option>
                          <option>1-10 employees</option>
                          <option>11-50 employees</option>
                          <option>51-200 employees</option>
                          <option>201-1000 employees</option>
                          <option>1000+ employees</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-6">
                    {/* Target Locations */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target Locations
                      </label>
                      <div className="relative">
                        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none">
                          <option>Select locations...</option>
                          <option>United States</option>
                          <option>Canada</option>
                          <option>United Kingdom</option>
                          <option>Germany</option>
                          <option>France</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Company Types */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Types
                      </label>
                      <div className="relative">
                        <select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none">
                          <option>Select company types...</option>
                          <option>Startup</option>
                          <option>Small Business</option>
                          <option>Mid-Market</option>
                          <option>Enterprise</option>
                          <option>Non-Profit</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Criteria */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center">
                      Additional Criteria (Optional)
                      <svg className="w-4 h-4 text-gray-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Any additional criteria or specific requirements for your ideal customer profile..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent resize-none"
                  />
                </div>

                {/* Form Actions */}
                <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                  >
                    Continue to Signals
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
