'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getCurrentUserToken } from '@/lib/auth-helpers';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, updateDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export default function AboutPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [error, setError] = useState('');
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [editedResults, setEditedResults] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [successSection, setSuccessSection] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Thinking...');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Check for existing analysis on component mount
  useEffect(() => {
    const loadExistingAnalysis = async () => {
      if (!user) {
        setLoadingExisting(false);
        return;
      }

      try {
        const q = query(
          collection(db, 'company_analyses'),
          where('user_id', '==', user.uid),
          limit(1)
        );

        const existingDocs = await getDocs(q);

        if (!existingDocs.empty) {
          const existingData = existingDocs.docs[0].data();
          const dataWithId = {
            id: existingDocs.docs[0].id,
            ...existingData
          };
          setAnalysisResults(dataWithId);
          setEditedResults(dataWithId); // Initialize edited state
          setWebsiteUrl(existingData.website || '');
          console.log('Loaded existing analysis:', existingDocs.docs[0].id);
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

    // Format URL - add https:// if not present
    let formattedUrl = websiteUrl.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    setIsAnalyzing(true);
    setError('');
    
    // Cycle through loading messages
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
    }, 3000); // Change message every 3 seconds
    
    try {
      const idToken = await getCurrentUserToken();
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      // Call API to analyze
      const response = await fetch('/api/analyze-and-store', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ website: formattedUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      console.log('Analysis result:', data);

      // Check if user already has an analysis document
      const q = query(
        collection(db, 'company_analyses'),
        where('user_id', '==', currentUser.uid),
        limit(1)
      );
      
      const existingDocs = await getDocs(q);

      let docRef;

      if (!existingDocs.empty) {
        // UPDATE existing document
        const existingDocRef = existingDocs.docs[0].ref;
        await updateDoc(existingDocRef, {
          ...data,
          analyzed_at: serverTimestamp(),
          status: 'completed',
        });
        docRef = { id: existingDocRef.id };
        console.log('Updated existing analysis:', existingDocRef.id);
      } else {
        // CREATE new document (first time)
        docRef = await addDoc(collection(db, 'company_analyses'), {
          ...data,
          analyzed_at: serverTimestamp(),
          status: 'completed',
        });
        console.log('Created new analysis:', docRef.id);
      }

      const resultWithId = {
        id: docRef.id,
        ...data
      };
      setAnalysisResults(resultWithId);
      setEditedResults(resultWithId); // Initialize edited state

    } catch (err) {
      console.error('Error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      clearInterval(messageInterval);
      setIsAnalyzing(false);
    }
  };

  // Toggle edit mode for a section
  const toggleEditSection = (sectionKey: string) => {
    setEditingSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey);
        // Reset changes for this section
        setEditedResults(analysisResults);
      } else {
        newSet.add(sectionKey);
      }
      return newSet;
    });
  };

  // Save changes for a specific section
  const handleSaveSection = async (sectionKey: string) => {
    if (!editedResults?.id || !user) return;

    setSavingSection(sectionKey);
    setError('');

    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      const q = query(
        collection(db, 'company_analyses'),
        where('user_id', '==', currentUser.uid),
        limit(1)
      );
      
      const existingDocs = await getDocs(q);

      if (!existingDocs.empty) {
        const docRef = existingDocs.docs[0].ref;
        
        // Remove the id field before updating
        const { id, ...dataToUpdate } = editedResults;
        
        await updateDoc(docRef, {
          ...dataToUpdate,
          analyzed_at: serverTimestamp(),
        });

        setAnalysisResults(editedResults);
        setSuccessSection(sectionKey);
        
        // Exit edit mode for this section
        setEditingSections(prev => {
          const newSet = new Set(prev);
          newSet.delete(sectionKey);
          return newSet;
        });
        
        console.log('Section saved successfully:', sectionKey);
        
        // Hide success message after 3 seconds
        setTimeout(() => setSuccessSection(null), 3000);
      }
    } catch (err) {
      console.error('Error saving section:', err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingSection(null);
    }
  };

  // Cancel editing a section
  const handleCancelSection = (sectionKey: string) => {
    setEditedResults(analysisResults); // Reset to original
    setEditingSections(prev => {
      const newSet = new Set(prev);
      newSet.delete(sectionKey);
      return newSet;
    });
  };

  // Update field value
  const handleFieldChange = (fieldPath: string, value: any) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: value
    }));
  };

  // Add item to array field
  const handleAddArrayItem = (fieldPath: string) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: [...(prev[fieldPath] || []), '']
    }));
  };

  // Remove item from array field
  const handleRemoveArrayItem = (fieldPath: string, index: number) => {
    setEditedResults((prev: any) => ({
      ...prev,
      [fieldPath]: prev[fieldPath].filter((_: any, i: number) => i !== index)
    }));
  };

  // Update array item
  const handleArrayItemChange = (fieldPath: string, index: number, value: string) => {
    setEditedResults((prev: any) => {
      const newArray = [...(prev[fieldPath] || [])];
      newArray[index] = value;
      return {
        ...prev,
        [fieldPath]: newArray
      };
    });
  };

  // Clear all data
  const handleClearData = async () => {
    if (!user || !analysisResults?.id) return;
    
    if (!confirm('Are you sure you want to clear all analysis data? This cannot be undone.')) {
      return;
    }

    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      const q = query(
        collection(db, 'company_analyses'),
        where('user_id', '==', currentUser.uid),
        limit(1)
      );
      
      const existingDocs = await getDocs(q);

      if (!existingDocs.empty) {
        const docRef = existingDocs.docs[0].ref;
        await updateDoc(docRef, {});
        
        setAnalysisResults(null);
        setEditedResults(null);
        setWebsiteUrl('');
        console.log('Data cleared successfully');
      }
    } catch (err) {
      console.error('Error clearing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to clear data');
    }
  };

  if (loading || loadingExisting) {
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
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4 text-center">
                  Company Analysis
                </h2>
                <div className="max-w-3xl mx-auto">
                  <p className="text-lg text-gray-600 text-center mb-4">
                    In this page, we build a comprehensive profile of your business so we can understand who you are, what you do, and what your customers care about. 
                    This helps us to understand your company's unique characteristics, differentiators, target markets, and value props.
                  </p>
                  <p className="text-base text-gray-600 text-center">
                    It should only take a minute for our agents to do this. Hang tight.
                  </p>
                </div>
              </div>

              {/* Website Input Form */}
              <div className="mb-8">
                <form onSubmit={handleAnalyze} className="max-w-2xl mx-auto">
                  <div className="space-y-4">
                    <div>
                      <input
                        type="text"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="Enter your domain (e.g., example.com)"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-center"
                        required
                      />
                    </div>
                    <div className="flex justify-center">
                      {!isAnalyzing ? (
                        <div className="relative group">
                          <button
                            type="submit"
                            disabled={!websiteUrl.trim()}
                            className="px-8 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
                          >
                            {analysisResults ? 'Reanalyse' : 'Run Analysis'}
                          </button>
                          {analysisResults && (
                            <div className="absolute left-1/2 transform -translate-x-1/2 top-full mt-2 w-56 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none">
                              <div className="flex items-start gap-2">
                                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>This will overwrite your current analysis data</span>
                              </div>
                              <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 py-3">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal"></div>
                          <span className="text-lg font-medium text-gray-700">{loadingMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </form>

                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700">{error}</p>
                  </div>
                )}
              </div>


                {/* Analysis Results */}
                {analysisResults && editedResults && (() => {
                  // Helper function to check if field is populated
                  const isPopulated = (field: any) => {
                    if (Array.isArray(field)) return field && field.length > 0;
                    if (typeof field === 'string') return field && field.trim().length > 0;
                    return field != null && field !== '';
                  };

                  // Define all possible sections with their data
                  const sections = [
                    {
                      title: 'Company Overview',
                      key: 'company_overview',
                      fields: [
                        { label: 'Domain', key: 'domain', value: editedResults.domain, type: 'text' },
                        { label: 'Company Name', key: 'company_name', value: editedResults.company_name, type: 'text' },
                        { label: 'Description', key: 'description', value: editedResults.description, type: 'textarea' }
                      ]
                    },
                    {
                      title: 'Unique Characteristics',
                      key: 'unique_characteristics',
                      data: editedResults.unique_characteristics,
                      type: 'list'
                    },
                    {
                      title: 'Business Model',
                      key: 'business_model',
                      data: editedResults.business_model,
                      type: 'list'
                    },
                    {
                      title: 'Operating Environment',
                      key: 'operating_environment',
                      data: editedResults.operating_environment,
                      type: 'list'
                    },
                    {
                      title: 'Market Summary',
                      key: 'market_summary',
                      data: editedResults.market_summary,
                      type: 'list'
                    },
                    {
                      title: 'Customers We Serve',
                      key: 'customers_we_serve',
                      data: editedResults.customers_we_serve,
                      type: 'list'
                    },
                    {
                      title: 'Why Customers Buy',
                      key: 'why_customers_buy',
                      data: editedResults.why_customers_buy,
                      type: 'list'
                    },
                    {
                      title: 'Differentiated Value',
                      key: 'differentiated_value',
                      data: editedResults.differentiated_value,
                      type: 'list'
                    },
                    {
                      title: 'Status Quo',
                      key: 'status_quo',
                      data: editedResults.status_quo,
                      type: 'list'
                    },
                    {
                      title: 'Capabilities',
                      key: 'capabilities',
                      data: editedResults.capabilities,
                      type: 'list'
                    },
                    {
                      title: 'Challenges Addressed',
                      key: 'challenges_addressed',
                      data: editedResults.challenges_addressed,
                      type: 'list'
                    },
                    {
                      title: 'Customer Benefits',
                      key: 'customer_benefits',
                      data: editedResults.customer_benefits,
                      type: 'list'
                    },
                    {
                      title: 'Good Fit',
                      key: 'good_fit',
                      data: editedResults.good_fit,
                      type: 'list',
                      icon: '✓'
                    },
                    {
                      title: 'Bad Fit',
                      key: 'bad_fit',
                      data: editedResults.bad_fit,
                      type: 'list',
                      icon: '✗'
                    }
                  ];

                  // Separate populated and unpopulated sections
                  const populatedSections = sections.filter(section => {
                    if (section.fields) {
                      return section.fields.some(f => isPopulated(f.value));
                    }
                    return isPopulated(section.data);
                  });

                  const unpopulatedSections = sections.filter(section => {
                    if (section.fields) {
                      return !section.fields.some(f => isPopulated(f.value));
                    }
                    return !isPopulated(section.data);
                  });

                  // Render a section card with per-section edit controls
                  const renderSection = (section: any, index: number) => {
                    const sectionKey = section.key || section.title;
                    const isEditing = editingSections.has(sectionKey);
                    const isSavingThis = savingSection === sectionKey;
                    const isSuccess = successSection === sectionKey;

                    return (
                    <div key={index} className="bg-white rounded-lg border border-gray-200 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-arcova-darkblue">{section.title}</h4>
                        <div className="flex items-center gap-2">
                          {isSuccess && (
                            <span className="text-green-600 text-sm flex items-center gap-1">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                              Saved
                            </span>
                          )}
                          {!isEditing ? (
                            <div className="relative group">
                              <button
                                onClick={() => toggleEditSection(sectionKey)}
                                className="px-3 py-1 text-sm bg-white border border-gray-300 text-gray-700 rounded hover:border-arcova-teal hover:text-arcova-teal transition-colors flex items-center gap-1"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edit
                              </button>
                              {/* Tooltip */}
                              <div className="absolute right-0 top-full mt-2 w-64 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 pointer-events-none">
                                <div className="flex items-start gap-2">
                                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span>Edit fields to improve accuracy. Your agent learns from your updates.</span>
                                </div>
                                {/* Arrow */}
                                <div className="absolute -top-1 right-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => handleCancelSection(sectionKey)}
                                className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSaveSection(sectionKey)}
                                disabled={isSavingThis}
                                className="px-3 py-1 text-sm bg-arcova-teal text-white rounded hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors flex items-center gap-1"
                              >
                                {isSavingThis ? (
                                  <>
                                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                    Saving...
                                  </>
                                ) : (
                                  'Save'
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {section.fields ? (
                        <div className="space-y-3">
                          {section.fields.map((field: any, idx: number) => (
                            <div key={idx}>
                              <span className="font-medium text-gray-700 block mb-1">{field.label}:</span>
                              {isEditing ? (
                                field.type === 'textarea' ? (
                                  <textarea
                                    value={field.value || ''}
                                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                                    rows={3}
                                    placeholder={`Enter ${field.label.toLowerCase()}`}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    value={field.value || ''}
                                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                                    placeholder={`Enter ${field.label.toLowerCase()}`}
                                  />
                                )
                              ) : (
                                <p className="text-gray-900">{field.value || <span className="text-gray-400 italic">Not provided</span>}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(section.data && section.data.length > 0) ? (
                            section.data.map((item: string, idx: number) => (
                              isEditing ? (
                                <div key={idx} className="flex items-start gap-2">
                                  <span className="text-arcova-teal mt-2">{section.icon || '•'}</span>
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => handleArrayItemChange(section.key, idx, e.target.value)}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                                    placeholder="Enter item"
                                  />
                                  <button
                                    onClick={() => handleRemoveArrayItem(section.key, idx)}
                                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remove item"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div key={idx} className="flex items-start">
                                  <span className="text-arcova-teal mr-2">{section.icon || '•'}</span>
                                  <span className="text-gray-700">{item}</span>
                                </div>
                              )
                            ))
                          ) : (
                            <p className="text-gray-400 italic">No items yet</p>
                          )}
                          {isEditing && (
                            <button
                              onClick={() => handleAddArrayItem(section.key)}
                              className="mt-2 px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              + Add Item
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  };

                  return (
                    <div className="mt-8">
                      <h3 className="text-2xl font-bold text-gray-900 mb-6 text-left">
                        About {editedResults.company_name || 'Your Company'}
                      </h3>
                      
                      {/* Populated sections first */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                        {populatedSections.map((section, index) => renderSection(section, index))}
                      </div>
                      
                      {/* Unpopulated sections at the bottom */}
                      {unpopulatedSections.length > 0 && (
                        <>
                          <div className="border-t border-gray-200 my-8 pt-8">
                            <h4 className="text-lg font-semibold text-gray-500 mb-4">Additional Fields</h4>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {unpopulatedSections.map((section, index) => renderSection(section, index))}
                          </div>
                        </>
                      )}

                      {/* Clear Data Button */}
                      <div className="border-t border-gray-200 mt-12 pt-8">
                        <div className="flex justify-center">
                          <button
                            onClick={handleClearData}
                            className="px-6 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium flex items-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Clear All Data
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

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
