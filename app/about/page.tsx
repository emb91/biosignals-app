'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';

export default function AboutPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteUrl.trim()) return;

    setIsAnalyzing(true);
    setError('');
    setAnalysisResults(null);

    try {
      const response = await fetch('/api/analyze-company', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ website: websiteUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        setError(`Analysis failed: ${errorData.error || 'Unknown error'}`);
        return;
      }

      const data = await response.json();
      setAnalysisResults(data);
    } catch (err) {
      console.error('Network Error:', err);
      setError(`Network error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

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
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  Company Analysis
                </h2>
                <p className="text-lg text-gray-600">
                  Enter a company website URL to analyze their market position and performance.
                </p>
              </div>

              {/* Website Input Form */}
              <div className="mb-8">
                <form onSubmit={handleAnalyze} className="max-w-2xl mx-auto">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="Enter company website URL (e.g., https://example.com)"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAnalyzing || !websiteUrl.trim()}
                      className="px-8 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                    >
                      {isAnalyzing ? (
                        <div className="flex items-center">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Analyzing...
                        </div>
                      ) : (
                        'Analyze Company'
                      )}
                    </button>
                  </div>
                </form>

                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700">{error}</p>
                  </div>
                )}
              </div>

              {/* Analysis Results */}
              {analysisResults && (
                <div className="mt-8">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">Analysis Results</h3>
                  <div className="bg-gray-50 rounded-lg p-6">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-auto">
                      {JSON.stringify(analysisResults, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Sample Analysis Preview */}
              {!analysisResults && !isAnalyzing && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Market Analysis */}
                  <div className="space-y-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">Market Analysis</h3>
                    
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-blue-900 font-medium">Market Position</span>
                        <span className="text-2xl font-bold text-blue-600">-</span>
                      </div>
                      <p className="text-sm text-blue-700 mt-1">Industry ranking</p>
                    </div>

                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-green-900 font-medium">Competitive Advantage</span>
                        <span className="text-2xl font-bold text-green-600">-</span>
                      </div>
                      <p className="text-sm text-green-700 mt-1">Key differentiators</p>
                    </div>

                    <div className="bg-orange-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-orange-900 font-medium">Growth Potential</span>
                        <span className="text-2xl font-bold text-orange-600">-</span>
                      </div>
                      <p className="text-sm text-orange-700 mt-1">Market opportunity</p>
                    </div>
                  </div>

                  {/* Performance Metrics */}
                  <div className="space-y-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">Performance Metrics</h3>
                    
                    <div className="bg-purple-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-purple-900 font-medium">Revenue Growth</span>
                        <span className="text-2xl font-bold text-purple-600">-</span>
                      </div>
                      <p className="text-sm text-purple-700 mt-1">Year over year</p>
                    </div>

                    <div className="bg-indigo-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-indigo-900 font-medium">Customer Acquisition</span>
                        <span className="text-2xl font-bold text-indigo-600">-</span>
                      </div>
                      <p className="text-sm text-indigo-700 mt-1">New customers</p>
                    </div>

                    <div className="bg-pink-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-pink-900 font-medium">Market Share</span>
                        <span className="text-2xl font-bold text-pink-600">-</span>
                      </div>
                      <p className="text-sm text-pink-700 mt-1">Industry segment</p>
                    </div>
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
