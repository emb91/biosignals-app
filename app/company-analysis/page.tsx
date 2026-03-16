'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/lib/supabase';
import { getDisplayName } from '@/lib/auth-helpers';

export default function CompanyAnalysisPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [editedResults, setEditedResults] = useState<any>(null);
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [successSection, setSuccessSection] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Thinking...');

  const firstName = user ? getDisplayName(user) : '';

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Load existing analysis on mount
  useEffect(() => {
    const loadExistingAnalysis = async () => {
      if (!user) {
        setLoadingExisting(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('company_analyses')
          .select('*')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (data && !error) {
          setAnalysisResults(data);
          setEditedResults(data);
          setWebsiteUrl(data.website || '');
        }
      } catch (err) {
        console.error('Error loading existing analysis:', err);
      } finally {
        setLoadingExisting(false);
      }
    };

    loadExistingAnalysis();
  }, [user]);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!websiteUrl.trim()) return;

    let formattedUrl = websiteUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    setIsAnalyzing(true);
    setError('');
    
    const messages = [
      'Thinking...',
      'Visiting your website...',
      'Scanning for details...',
      'Analyzing content...',
      'Building your profile...'
    ];
    
    let messageIndex = 0;
    setLoadingMessage(messages[0]);
    
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % messages.length;
      setLoadingMessage(messages[messageIndex]);
    }, 3000);
    
    try {
      const response = await fetch('/api/analyze-and-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: formattedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAnalysisResults(data);
      setEditedResults(data);

    } catch (err) {
      console.error('Error:', err);
      
      let userMessage = 'Something went wrong. Please try again.';
      
      if (err instanceof Error) {
        const errorMsg = err.message.toLowerCase();
        
        if (errorMsg.includes('503') || errorMsg.includes('502') || errorMsg.includes('forbidden')) {
          userMessage = "This website is blocking our requests. Try a different company website!";
        } else if (errorMsg.includes('timeout')) {
          userMessage = "This is taking longer than expected. Try again in a moment!";
        } else if (errorMsg.includes('unauthorized')) {
          userMessage = "Your session expired. Please refresh the page.";
        }
      }
      
      setError(userMessage);
    } finally {
      clearInterval(messageInterval);
      setIsAnalyzing(false);
    }
  };

  const toggleEditSection = (sectionKey: string) => {
    setEditingSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey);
        setEditedResults(analysisResults);
      } else {
        newSet.add(sectionKey);
      }
      return newSet;
    });
  };

  const handleSaveSection = async (sectionKey: string) => {
    if (!editedResults?.id || !user) return;

    setSavingSection(sectionKey);
    setError('');

    try {
      const response = await fetch('/api/user-analyses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedResults),
      });

      if (!response.ok) {
        throw new Error('Failed to save changes');
      }

      const updatedData = await response.json();
      setAnalysisResults(updatedData);
      setSuccessSection(sectionKey);
      
      setEditingSections(prev => {
        const newSet = new Set(prev);
        newSet.delete(sectionKey);
        return newSet;
      });
      
      setTimeout(() => setSuccessSection(null), 3000);
    } catch (err) {
      console.error('Error saving section:', err);
      setError('Failed to save changes');
    } finally {
      setSavingSection(null);
    }
  };

  const handleCancelSection = (sectionKey: string) => {
    setEditedResults(analysisResults);
    setEditingSections(prev => {
      const newSet = new Set(prev);
      newSet.delete(sectionKey);
      return newSet;
    });
  };

  const handleFieldChange = (fieldPath: string, value: any) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: value
    }));
  };

  const handleArrayItemChange = (fieldPath: string, index: number, value: string) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: prev[fieldPath].map((item: string, i: number) => 
        i === index ? value : item
      )
    }));
  };

  const handleAddArrayItem = (fieldPath: string) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: [...(prev[fieldPath] || []), '']
    }));
  };

  const handleRemoveArrayItem = (fieldPath: string, index: number) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: prev[fieldPath].filter((_: any, i: number) => i !== index)
    }));
  };

  const handleClearData = async () => {
    if (!analysisResults?.id || !confirm('Are you sure you want to clear all analysis data?')) return;

    try {
      const response = await fetch(`/api/user-analyses?id=${analysisResults.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete');
      }

      setAnalysisResults(null);
      setEditedResults(null);
      setWebsiteUrl('');
    } catch (err) {
      console.error('Error clearing data:', err);
      setError('Failed to clear data');
    }
  };

  if (loading || loadingExisting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Define sections for display
  const getSections = () => {
    if (!editedResults) return [];
    
    return [
      { key: 'company_name', title: 'Company Name', icon: '🏢', fields: [
        { key: 'company_name', label: 'Name', value: editedResults.company_name, type: 'text' }
      ]},
      { key: 'description', title: 'Description', icon: '📝', fields: [
        { key: 'description', label: 'Description', value: editedResults.description, type: 'textarea' }
      ]},
      { key: 'products_services', title: 'Products & Services', icon: '🛍️', data: editedResults.products_services || [] },
      { key: 'target_customers', title: 'Target Customers', icon: '🎯', data: editedResults.target_customers || [] },
      { key: 'value_propositions', title: 'Value Propositions', icon: '💎', data: editedResults.value_propositions || [] },
      { key: 'industries', title: 'Industries', icon: '🏭', data: editedResults.industries || [] },
      { key: 'technologies', title: 'Technologies', icon: '💻', data: editedResults.technologies || [] },
      { key: 'competitors', title: 'Competitors', icon: '⚔️', data: editedResults.competitors || [] },
    ];
  };

  const sections = getSections();
  const populatedSections = sections.filter(s => 
    s.fields ? s.fields.some(f => f.value) : (s.data && s.data.length > 0)
  );
  const unpopulatedSections = sections.filter(s => 
    s.fields ? !s.fields.some(f => f.value) : (!s.data || s.data.length === 0)
  );

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
          <div className="max-w-4xl mx-auto">
            {/* URL Input Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Company Analysis</h2>
              <p className="text-gray-600 mb-6">
                Enter your company website to generate an AI-powered analysis of your business.
              </p>
              
              <form onSubmit={handleAnalyze} className="flex gap-4">
                <input
                  type="text"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="Enter company website (e.g., acme.com)"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                  disabled={isAnalyzing}
                />
                <button
                  type="submit"
                  disabled={isAnalyzing || !websiteUrl.trim()}
                  className="px-6 py-3 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isAnalyzing ? loadingMessage : (analysisResults ? 'Re-analyze' : 'Analyze')}
                </button>
              </form>

              {error && (
                <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
                  {error}
                </div>
              )}
            </div>

            {/* Loading State */}
            {isAnalyzing && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal mx-auto mb-4"></div>
                <p className="text-lg text-gray-600">{loadingMessage}</p>
              </div>
            )}

            {/* Results */}
            {analysisResults && !isAnalyzing && (
              <div className="space-y-6">
                <div className="mb-8">
                  <h3 className="text-3xl font-bold text-arcova-darkblue mb-3">
                    {editedResults?.company_name || 'Your Company'} Analysis
                  </h3>
                  {editedResults?.domain && (
                    <a 
                      href={editedResults.domain.startsWith('http') ? editedResults.domain : `https://${editedResults.domain}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-arcova-teal hover:text-arcova-darkblue transition-colors text-lg inline-flex items-center gap-2"
                    >
                      {editedResults.domain}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>

                {/* Populated Sections */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {populatedSections.map((section) => {
                    const isEditing = editingSections.has(section.key);
                    const isSavingThis = savingSection === section.key;
                    const isSuccess = successSection === section.key;

                    return (
                      <div key={section.key} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                            <span>{section.icon}</span>
                            {section.title}
                          </h4>
                          <div className="flex items-center gap-2">
                            {isSuccess && <span className="text-green-600 text-sm">✓ Saved</span>}
                            {!isEditing ? (
                              <button
                                onClick={() => toggleEditSection(section.key)}
                                className="text-sm text-arcova-teal hover:text-arcova-darkblue"
                              >
                                Edit
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleCancelSection(section.key)}
                                  className="text-sm text-gray-500 hover:text-gray-700"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveSection(section.key)}
                                  disabled={isSavingThis}
                                  className="text-sm bg-arcova-teal text-white px-3 py-1 rounded hover:bg-arcova-teal/90 disabled:opacity-50"
                                >
                                  {isSavingThis ? 'Saving...' : 'Save'}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {section.fields ? (
                          <div className="space-y-3">
                            {section.fields.map((field) => (
                              <div key={field.key}>
                                {isEditing ? (
                                  field.type === 'textarea' ? (
                                    <textarea
                                      value={field.value || ''}
                                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                                      rows={3}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={field.value || ''}
                                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                                    />
                                  )
                                ) : (
                                  <p className="text-gray-700">{field.value || <span className="text-gray-400 italic">Not provided</span>}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {section.data?.map((item: string, idx: number) => (
                              <div key={idx} className="flex items-start gap-2">
                                <span className="text-arcova-teal">•</span>
                                {isEditing ? (
                                  <div className="flex-1 flex gap-2">
                                    <input
                                      type="text"
                                      value={item}
                                      onChange={(e) => handleArrayItemChange(section.key, idx, e.target.value)}
                                      className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                                    />
                                    <button
                                      onClick={() => handleRemoveArrayItem(section.key, idx)}
                                      className="text-red-500 hover:text-red-700"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-gray-700">{item}</span>
                                )}
                              </div>
                            ))}
                            {isEditing && (
                              <button
                                onClick={() => handleAddArrayItem(section.key)}
                                className="text-sm text-arcova-teal hover:text-arcova-darkblue mt-2"
                              >
                                + Add Item
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Unpopulated Sections */}
                {unpopulatedSections.length > 0 && (
                  <>
                    <div className="relative my-8">
                      <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-gray-200"></div>
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-gray-50 px-4 text-sm text-gray-500">Additional Fields</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {unpopulatedSections.map((section) => (
                        <div key={section.key} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 opacity-60">
                          <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                            <span>{section.icon}</span>
                            {section.title}
                          </h4>
                          <p className="text-gray-400 italic">No data available</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Clear Data Button */}
                <div className="border-t border-gray-200 pt-8 mt-8">
                  <div className="flex justify-center">
                    <button
                      onClick={handleClearData}
                      className="px-6 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium"
                    >
                      Clear All Data
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!analysisResults && !isAnalyzing && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="text-gray-400 mb-4">
                  <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Analysis Yet</h3>
                <p className="text-gray-500">Enter a company website URL above to get started.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
