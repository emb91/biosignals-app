'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getDisplayName } from '@/lib/auth-helpers';
import { toast, Toaster } from 'sonner';

interface CompanyProfile {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  company_sizes: string[];
  funding_stages: string[];
}

const FUNCTION_OPTIONS = [
  "Executive / Leadership",
  "Commercial & Sales",
  "Business Development & Partnerships",
  "Marketing",
  "Medical Affairs",
  "Clinical Operations",
  "Regulatory Affairs",
  "Research & Development (R&D)",
  "Manufacturing & CMC",
  "Supply Chain & Procurement",
  "Finance",
  "Strategy & Corporate Development",
  "Data & Technology",
  "People & HR",
  "Legal & Compliance"
];

const SENIORITY_OPTIONS = [
  "C-Level",
  "VP / SVP",
  "Director",
  "Head of / Senior Manager",
  "Manager",
  "Individual Contributor"
];

export default function ContactEditPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const contactId = params.id as string;
  const firstName = user ? getDisplayName(user) : '';

  const [currentSection, setCurrentSection] = useState(2);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    functions: [] as string[],
    seniorityLevels: [] as string[],
  });
  const [customFunction, setCustomFunction] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showAllFunctions, setShowAllFunctions] = useState(false);

  const selectedCompany = companyProfiles.find(c => c.id === selectedCompanyId);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contactRes, companiesRes] = await Promise.all([
          fetch(`/api/contacts/${contactId}`),
          fetch('/api/companies'),
        ]);
        
        if (contactRes.ok) {
          const contactData = await contactRes.json();
          const contact = contactData.data;
          
          if (contact) {
            // Parse weighted functions back to names
            const functionNames = contact.functions?.map((f: string) => {
              try {
                const parsed = JSON.parse(f);
                return parsed.name || f;
              } catch {
                return f;
              }
            }) || [];

            setFormData({
              name: contact.name || '',
              functions: functionNames,
              seniorityLevels: contact.seniority_levels || [],
            });
            setSelectedCompanyId(contact.icp_id || null);
          }
        } else {
          toast.error('Contact not found');
          router.push('/contacts');
        }
        
        if (companiesRes.ok) {
          const data = await companiesRes.json();
          setCompanyProfiles(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load contact data');
      } finally {
        setLoadingData(false);
      }
    };

    if (user && contactId) {
      fetchData();
    }
  }, [user, contactId, router]);

  const handleFunctionToggle = (func: string) => {
    setFormData(prev => {
      const current = prev.functions;
      if (current.includes(func)) {
        return { ...prev, functions: current.filter(f => f !== func) };
      }
      return { ...prev, functions: [...current, func] };
    });
  };

  const handleAddCustomFunction = () => {
    const func = customFunction.trim();
    if (!func) return;
    if (formData.functions.includes(func)) {
      toast.error('Business area already added');
      return;
    }
    setFormData(prev => ({
      ...prev,
      functions: [...prev.functions, func],
    }));
    setCustomFunction('');
  };

  const handleSeniorityToggle = (level: string) => {
    setFormData(prev => {
      const current = prev.seniorityLevels;
      if (current.includes(level)) {
        return { ...prev, seniorityLevels: current.filter(l => l !== level) };
      } else {
        return { ...prev, seniorityLevels: [...current, level] };
      }
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.functions.length === 0) {
      toast.error('Please select at least one business area');
      setCurrentSection(2);
      return;
    }

    if (formData.seniorityLevels.length === 0) {
      toast.error('Please select at least one seniority level');
      setCurrentSection(3);
      return;
    }

    if (!formData.name.trim()) {
      toast.error('Please enter a name for this contact profile');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          icpId: selectedCompanyId,
          jobTitles: [],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update contact profile');
      }

      toast.success('Contact profile updated');
      router.push('/contacts');
    } catch (error) {
      console.error('Error updating contact:', error);
      toast.error('Failed to update contact profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSectionStatus = (section: number): 'complete' | 'incomplete' | 'current' => {
    if (section === currentSection) return 'current';
    switch (section) {
      case 2: return formData.functions.length > 0 ? 'complete' : 'incomplete';
      case 3: return formData.seniorityLevels.length > 0 ? 'complete' : 'incomplete';
      case 4: return formData.name ? 'complete' : 'incomplete';
      default: return 'incomplete';
    }
  };

  if (loading || loadingData) {
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
          <div className="max-w-3xl mx-auto">
            {/* Linked Company Profile Display */}
            {selectedCompany && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Editing contacts for</p>
                <p className="font-medium text-gray-900">{selectedCompany.name}</p>
              </div>
            )}

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between">
                {[2, 3, 4].map((step, index) => (
                  <div key={step} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setCurrentSection(step)}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                        currentSection === step
                          ? 'bg-arcova-teal text-white'
                          : getSectionStatus(step) === 'complete'
                          ? 'bg-arcova-teal/20 text-arcova-teal'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {getSectionStatus(step) === 'complete' && currentSection !== step ? (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </button>
                    {index < 2 && (
                      <div className={`flex-1 h-0.5 mx-1 ${
                        getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span className={currentSection === 2 ? 'text-arcova-teal font-medium' : ''}>Business Areas</span>
                <span className={currentSection === 3 ? 'text-arcova-teal font-medium' : ''}>Seniority</span>
                <span className={currentSection === 4 ? 'text-arcova-teal font-medium' : ''}>Name</span>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <form onSubmit={handleSave}>
                {/* Section 2: Business Areas */}
                {currentSection === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which business areas should we target?</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        These are suggested based on your setup. Select all that matter.
                      </p>
                    </div>

                    {/* Selected business areas */}
                    {formData.functions.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {formData.functions.map((func) => (
                          <button
                            key={func}
                            type="button"
                            onClick={() => handleFunctionToggle(func)}
                            className="px-3 py-1.5 rounded-full text-sm bg-arcova-teal text-white hover:bg-arcova-teal/90 transition-colors"
                          >
                            {func} ×
                          </button>
                        ))}
                      </div>
                    )}

                    {/* See all business areas toggle */}
                    <button
                      type="button"
                      onClick={() => setShowAllFunctions(!showAllFunctions)}
                      className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                    >
                      {showAllFunctions ? 'Hide all business areas' : 'See all business areas'}
                      <svg
                        className={`w-4 h-4 transition-transform ${showAllFunctions ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* All business areas (collapsible) */}
                    {showAllFunctions && (
                      <div className="space-y-4 pt-2 border-t border-gray-200">
                        <div className="flex flex-wrap gap-2">
                          {FUNCTION_OPTIONS.map((func) => {
                            const isSelected = formData.functions.includes(func);
                            return (
                              <button
                                key={func}
                                type="button"
                                onClick={() => handleFunctionToggle(func)}
                                className={`px-4 py-2 rounded-full text-sm transition-colors ${
                                  isSelected
                                    ? 'bg-arcova-teal text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {func}
                              </button>
                            );
                          })}
                        </div>

                        {/* Other - custom input */}
                        <div className="pt-3 border-t border-gray-200">
                          <label className="text-sm text-gray-600 mb-2 block">Other business area not listed?</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={customFunction}
                              onChange={(e) => setCustomFunction(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddCustomFunction();
                                }
                              }}
                              placeholder="Enter custom business area"
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm"
                            />
                            <button
                              type="button"
                              onClick={handleAddCustomFunction}
                              disabled={!customFunction.trim()}
                              className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50 text-sm"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-gray-500 mt-2">{formData.functions.length} selected</p>
                  </div>
                )}

                {/* Section 3: Seniority */}
                {currentSection === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which seniority levels are worth your time?</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        Select the seniority levels you want to target.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {SENIORITY_OPTIONS.map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => handleSeniorityToggle(level)}
                          className={`px-4 py-2 rounded-full text-sm transition-colors ${
                            formData.seniorityLevels.includes(level)
                              ? 'bg-arcova-teal text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 4: Name */}
                {currentSection === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Name this contact profile</h2>
                      <p className="text-sm text-gray-500 mb-4">Update the name if needed.</p>
                    </div>

                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., VP-level BD at Series A Oncology Biotech"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                    />

                    {/* Summary */}
                    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                      <h3 className="font-medium text-gray-900 mb-3">Profile Summary</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">Company Profile:</span>
                          <span className="ml-2 text-gray-900">{selectedCompany?.name || 'None selected'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Functions:</span>
                          <span className="ml-2 text-gray-900">{formData.functions.join(', ') || 'None selected'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Seniority:</span>
                          <span className="ml-2 text-gray-900">{formData.seniorityLevels.join(', ') || 'None selected'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentSection > 2) {
                        setCurrentSection(currentSection - 1);
                      } else {
                        router.push('/contacts');
                      }
                    }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    {currentSection === 2 ? 'Cancel' : 'Back'}
                  </button>
                  
                  {currentSection < 4 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentSection(currentSection + 1);
                      }}
                      disabled={currentSection === 2 && formData.functions.length === 0}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Updating...
                        </>
                      ) : (
                        'Update'
                      )}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}
