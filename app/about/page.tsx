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
      const response = await fetch('/api/analyze-and-store', {
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
      console.log('Analysis stored with Firebase ID:', data.id);
      console.log('Full response data:', data);
      console.log('Data keys:', Object.keys(data));
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
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">Company Analysis Results</h3>
                    
                    {/* Company Overview */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Company Overview</h4>
                        <div className="space-y-3">
                          <div>
                            <span className="font-medium text-gray-700">Domain:</span>
                            <p className="text-gray-900">{analysisResults.domain}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Company Name:</span>
                            <p className="text-gray-900">{analysisResults.company_name}</p>
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Description:</span>
                            <p className="text-gray-900">{analysisResults.description}</p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Unique Characteristics</h4>
                        <div className="space-y-2">
                          {analysisResults.unique_characteristics?.map((characteristic: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{characteristic}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Business Model & Environment */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Business Model</h4>
                        <div className="space-y-2">
                          {analysisResults.business_model?.map((model: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{model}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Operating Environment</h4>
                        <div className="space-y-2">
                          {analysisResults.operating_environment?.map((env: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{env}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Market & Customers */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Market Summary</h4>
                        <div className="space-y-2">
                          {analysisResults.market_summary?.map((summary: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{summary}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Customers We Serve</h4>
                        <div className="space-y-2">
                          {analysisResults.customers_we_serve?.map((customer: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{customer}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Value Proposition */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Why Customers Buy</h4>
                        <div className="space-y-2">
                          {analysisResults.why_customers_buy?.map((reason: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Differentiated Value</h4>
                        <div className="space-y-2">
                          {analysisResults.differentiated_value?.map((value: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Status Quo & Capabilities */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Status Quo</h4>
                        <div className="space-y-2">
                          {analysisResults.status_quo?.map((status: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{status}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Capabilities</h4>
                        <div className="space-y-2">
                          {analysisResults.capabilities?.map((capability: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{capability}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Challenges & Benefits */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Challenges Addressed</h4>
                        <div className="space-y-2">
                          {analysisResults.challenges_addressed?.map((challenge: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{challenge}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <h4 className="text-lg font-semibold text-arcova-darkblue mb-4">Customer Benefits</h4>
                        <div className="space-y-2">
                          {analysisResults.customer_benefits?.map((benefit: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-arcova-teal mr-2">•</span>
                              <span className="text-gray-700">{benefit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Fit Analysis */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="bg-green-50 rounded-lg border border-green-200 p-6">
                        <h4 className="text-lg font-semibold text-green-800 mb-4">Good Fit</h4>
                        <div className="space-y-2">
                          {analysisResults.good_fit?.map((fit: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-green-600 mr-2">✓</span>
                              <span className="text-green-700">{fit}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-red-50 rounded-lg border border-red-200 p-6">
                        <h4 className="text-lg font-semibold text-red-800 mb-4">Bad Fit</h4>
                        <div className="space-y-2">
                          {analysisResults.bad_fit?.map((fit: string, index: number) => (
                            <div key={index} className="flex items-start">
                              <span className="text-red-600 mr-2">✗</span>
                              <span className="text-red-700">{fit}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {/* Empty State */}
              {!analysisResults && !isAnalyzing && (
                <div className="text-center py-12">
                  <div className="text-gray-400 mb-4">
                    <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Analysis Yet</h3>
                  <p className="text-gray-500">Enter a company website URL above to get started with your analysis.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
