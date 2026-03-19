'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/lib/supabase';
export default function CompanyAnalysisPage() {
  const { user, loading } = useAuth();
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [showAnalyzeForm, setShowAnalyzeForm] = useState(false);
  const [isEditingCompanyName, setIsEditingCompanyName] = useState(false);
  const [savingCompanyName, setSavingCompanyName] = useState(false);


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
          .maybeSingle();

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
      setShowAnalyzeForm(false);

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

  const handleNextClick = () => {
    setShowConfirmModal(true);
  };

  const handleSaveCompanyName = async () => {
    if (!editedResults?.id || !user) return;

    setSavingCompanyName(true);
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
      setIsEditingCompanyName(false);
    } catch (err) {
      console.error('Error saving company name:', err);
      setError('Failed to save company name');
    } finally {
      setSavingCompanyName(false);
    }
  };

  const handleConfirmNext = async () => {
    if (!editedResults?.id || !user) {
      setShowConfirmModal(false);
      router.push('/companies');
      return;
    }

    setIsSavingAll(true);
    try {
      const response = await fetch('/api/user-analyses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedResults),
      });

      if (!response.ok) {
        throw new Error('Failed to save changes');
      }

      setShowConfirmModal(false);
      router.push('/companies');
    } catch (err) {
      console.error('Error saving:', err);
      setError('Failed to save changes');
      setShowConfirmModal(false);
    } finally {
      setIsSavingAll(false);
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

  // Helper to format array data for display
  const formatArrayValue = (value: any): string[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [value];
    return [];
  };

  // Define sections for display - only showing key fields for ICP seeding
  const getSections = () => {
    if (!editedResults) return [];
    
    return [
      { key: 'description', title: 'Description', icon: '📝', data: formatArrayValue(editedResults.description) },
      { key: 'customers_we_serve', title: 'Customers We Serve', icon: '🎯', data: formatArrayValue(editedResults.customers_we_serve) },
      { key: 'good_fit', title: 'We work best with...', icon: '✅', data: formatArrayValue(editedResults.good_fit) },
      { key: 'bad_fit', title: 'Not a fit for us', icon: '❌', data: formatArrayValue(editedResults.bad_fit) },
    ];
  };

  const sections = getSections();

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      
      <div className="flex-1 flex flex-col min-h-0">
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            {/* URL Input Form - only show when no results or user clicked Re-analyze */}
            {(!analysisResults || showAnalyzeForm) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">Company Analysis</h2>
                  {showAnalyzeForm && analysisResults && (
                    <button
                      onClick={() => setShowAnalyzeForm(false)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="text-gray-600 mb-6">
                  Let's analyze your business model. Please enter your company website.
                </p>
                
                <form onSubmit={handleAnalyze} className="flex gap-4">
                  <input
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="Enter company website (e.g. acme.com)"
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                    disabled={isAnalyzing}
                  />
                  <button
                    type="submit"
                    disabled={isAnalyzing || !websiteUrl.trim()}
                    className="px-6 py-3 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isAnalyzing ? loadingMessage : 'Analyze'}
                  </button>
                </form>

                {error && (
                  <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Loading State */}
            {isAnalyzing && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal mx-auto mb-4"></div>
                <p className="text-lg text-gray-600">{loadingMessage}</p>
              </div>
            )}

            {/* Results */}
            {analysisResults && !isAnalyzing && (
              <div className="space-y-4">
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-1">
                    {isEditingCompanyName ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editedResults?.company_name || ''}
                          onChange={(e) => handleFieldChange('company_name', e.target.value)}
                          className="text-2xl font-bold text-arcova-darkblue px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            setEditedResults(analysisResults);
                            setIsEditingCompanyName(false);
                          }}
                          className="text-sm text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveCompanyName}
                          disabled={savingCompanyName}
                          className="text-sm bg-arcova-teal text-white px-3 py-1 rounded hover:bg-arcova-teal/90 disabled:opacity-50"
                        >
                          {savingCompanyName ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-2xl font-bold text-arcova-darkblue">
                          {editedResults?.company_name || 'Your Company'}
                        </h3>
                        <button
                          onClick={() => setIsEditingCompanyName(true)}
                          className="text-sm text-arcova-teal hover:text-arcova-darkblue"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                  {editedResults?.domain && (
                    <a 
                      href={editedResults.domain.startsWith('http') ? editedResults.domain : `https://${editedResults.domain}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-arcova-teal hover:text-arcova-darkblue transition-colors text-sm inline-flex items-center gap-1"
                    >
                      {editedResults.domain}
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  )}
                </div>

                {/* Sections - 2x2 grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {sections.map((section) => {
                    const isEditing = editingSections.has(section.key);
                    const isSavingThis = savingSection === section.key;
                    const isSuccess = successSection === section.key;
                    const hasData = section.fields 
                      ? section.fields.some(f => f.value) 
                      : (section.data && section.data.length > 0);

                    return (
                      <div key={section.key} className={`bg-white rounded-lg shadow-sm border border-gray-200 p-4 ${!hasData ? 'opacity-60' : ''}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                            <span className="text-base">{section.icon}</span>
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
                          <div className="space-y-1">
                            {section.data && section.data.length > 0 ? (
                              <>
                                {section.data.map((item: string, idx: number) => (
                                  <div key={idx} className="flex items-start gap-1.5 text-sm">
                                    <span className="text-arcova-teal">•</span>
                                    {isEditing ? (
                                      <div className="flex-1 flex gap-1">
                                        <input
                                          type="text"
                                          value={item}
                                          onChange={(e) => handleArrayItemChange(section.key, idx, e.target.value)}
                                          className="flex-1 px-2 py-0.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                                        />
                                        <button
                                          onClick={() => handleRemoveArrayItem(section.key, idx)}
                                          className="text-red-500 hover:text-red-700 text-xs"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-gray-700">{item}</span>
                                    )}
                                  </div>
                                ))}
                              </>
                            ) : (
                              <p className="text-gray-400 italic text-sm">No data available</p>
                            )}
                            {isEditing && (
                              <button
                                onClick={() => handleAddArrayItem(section.key)}
                                className="text-xs text-arcova-teal hover:text-arcova-darkblue mt-1"
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

                {/* Bottom Buttons */}
                <div className="pt-4 mt-4">
                  <div className="flex justify-between items-center">
                    <button
                      onClick={() => setShowAnalyzeForm(true)}
                      className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg hover:bg-gray-600 transition-colors"
                    >
                      Re-analyze
                    </button>
                    <button
                      onClick={handleNextClick}
                      className="px-6 py-2 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmation Modal */}
            {showConfirmModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">Confirm Details</h3>
                  <p className="text-gray-600 mb-6">
                    Please click 'Next' if your company details are correct, otherwise click 'Go Back' to edit.
                  </p>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setShowConfirmModal(false)}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={handleConfirmNext}
                      disabled={isSavingAll}
                      className="px-6 py-2 bg-arcova-teal text-white font-semibold rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors"
                    >
                      {isSavingAll ? 'Saving...' : 'Next'}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
