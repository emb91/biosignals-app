'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getDisplayName } from '@/lib/auth-helpers';
import { toast, Toaster } from 'sonner';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

interface SellerProfile {
  company_name: string;
  description: string | string[];
  customers_we_serve: string | string[];
  good_fit: string | string[];
  bad_fit: string | string[];
}

const FUNCTION_OPTIONS = [
  "C-Suite & Leadership",
  "Business Development & Partnerships",
  "Clinical Operations",
  "Research & Development",
  "Manufacturing & CMC",
  "Regulatory Affairs",
  "Finance & Procurement",
  "Medical Affairs",
  "Lab Operations",
  "Commercial & Sales Operations",
  "Technology & Systems"
];

const SENIORITY_OPTIONS = [
  "C-Suite (CEO / CSO / CMO / COO)",
  "VP Level",
  "Director Level",
  "Head of / Senior Manager",
  "Manager"
];

interface SortableFunctionPillProps {
  id: string;
  name: string;
  onRemove: () => void;
}

function SortableFunctionPill({ id, name, onRemove }: SortableFunctionPillProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`px-3 py-1.5 rounded-full text-sm bg-arcova-teal text-white flex items-center gap-1.5 ${isDragging ? 'shadow-lg' : ''}`}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
        </svg>
      </span>
      {name}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        className="ml-1 hover:bg-white/20 rounded-full p-0.5"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function ContactNewPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const firstName = user ? getDisplayName(user) : '';

  const [currentSection, setCurrentSection] = useState(1);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    functions: [] as string[],
    seniorityLevels: [] as string[],
  });
  const [customFunction, setCustomFunction] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingFunctions, setIsGeneratingFunctions] = useState(false);
  const [isGeneratingSeniority, setIsGeneratingSeniority] = useState(false);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showAllFunctions, setShowAllFunctions] = useState(false);

  const selectedCompany = companyProfiles.find(c => c.id === selectedCompanyId);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFunctionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setFormData(prev => {
        const oldIndex = prev.functions.indexOf(active.id as string);
        const newIndex = prev.functions.indexOf(over.id as string);

        return {
          ...prev,
          functions: arrayMove(prev.functions, oldIndex, newIndex),
        };
      });
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch both company profiles and seller profile in parallel
        const [companiesRes, sellerRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/user-company-profile'),
        ]);
        
        if (companiesRes.ok) {
          const data = await companiesRes.json();
          setCompanyProfiles(data.data || []);
        }
        
        if (sellerRes.ok) {
          const data = await sellerRes.json();
          setSellerProfile(data.data || null);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load data');
      } finally {
        setLoadingProfiles(false);
      }
    };

    if (user) {
      fetchData();
    }
  }, [user]);

  const handleSelectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    const company = companyProfiles.find(c => c.id === companyId);
    if (company) {
      setCurrentSection(2);
      await generateSuggestedFunctions(company);
    }
  };

  const generateSuggestedFunctions = async (company: CompanyProfile) => {
    setIsGeneratingFunctions(true);
    try {
      const response = await fetch('/api/suggest-functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sellerProfile: sellerProfile,
          targetCompanyProfile: company,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.functions && Array.isArray(data.functions)) {
          const validFunctions = data.functions.filter((f: string) => FUNCTION_OPTIONS.includes(f));
          setFormData(prev => ({
            ...prev,
            functions: validFunctions.slice(0, 5),
          }));
        }
      }
    } catch (error) {
      console.error('Error generating functions:', error);
    } finally {
      setIsGeneratingFunctions(false);
    }
  };

  const generateSuggestedSeniority = async () => {
    if (!selectedCompany || formData.functions.length === 0) return;
    
    setIsGeneratingSeniority(true);
    try {
      const response = await fetch('/api/suggest-seniority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerProfile: sellerProfile,
          targetCompanyProfile: selectedCompany,
          selectedFunctions: formData.functions,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.seniority && Array.isArray(data.seniority)) {
          const validSeniority = data.seniority.filter((s: string) => SENIORITY_OPTIONS.includes(s));
          setFormData(prev => ({
            ...prev,
            seniorityLevels: validSeniority,
          }));
        }
      }
    } catch (error) {
      console.error('Error generating seniority:', error);
    } finally {
      setIsGeneratingSeniority(false);
    }
  };

  const generateProfileName = async () => {
    if (!selectedCompany || formData.functions.length === 0 || formData.seniorityLevels.length === 0) return;
    
    setIsGeneratingName(true);
    try {
      const response = await fetch('/api/generate-contact-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCompanyProfile: selectedCompany,
          selectedFunctions: formData.functions,
          selectedSeniority: formData.seniorityLevels,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.name) {
          setFormData(prev => ({
            ...prev,
            name: data.name,
          }));
        }
      }
    } catch (error) {
      console.error('Error generating name:', error);
    } finally {
      setIsGeneratingName(false);
    }
  };

  const handleFunctionToggle = (func: string) => {
    setFormData(prev => {
      const current = prev.functions;
      if (current.includes(func)) {
        return { ...prev, functions: current.filter(f => f !== func) };
      } else if (current.length < 5) {
        return { ...prev, functions: [...current, func] };
      }
      return prev;
    });
  };

  const handleAddCustomFunction = () => {
    const func = customFunction.trim();
    if (!func) return;
    if (formData.functions.includes(func)) {
      toast.error('Function already added');
      return;
    }
    if (formData.functions.length >= 5) {
      toast.error('Maximum 5 functions allowed');
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

    if (!selectedCompanyId) {
      toast.error('Please select a company profile');
      setCurrentSection(1);
      return;
    }

    if (formData.functions.length === 0) {
      toast.error('Please select at least one function');
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
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          icpId: selectedCompanyId,
          jobTitles: [],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save contact profile');
      }

      setShowSuccessModal(true);
    } catch (error) {
      console.error('Error saving contact:', error);
      toast.error('Failed to save contact profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSectionStatus = (section: number): 'complete' | 'incomplete' | 'current' => {
    if (section === currentSection) return 'current';
    switch (section) {
      case 1: return selectedCompanyId ? 'complete' : 'incomplete';
      case 2: return formData.functions.length > 0 ? 'complete' : 'incomplete';
      case 3: return formData.seniorityLevels.length > 0 ? 'complete' : 'incomplete';
      case 4: return formData.name ? 'complete' : 'incomplete';
      default: return 'incomplete';
    }
  };

  const handleNext = async () => {
    if (currentSection === 2) {
      setCurrentSection(3);
      await generateSuggestedSeniority();
    } else if (currentSection === 3) {
      setCurrentSection(4);
      await generateProfileName();
    } else {
      setCurrentSection(currentSection + 1);
    }
  };

  if (loading) {
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
            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (step === 1 || (step > 1 && selectedCompanyId)) {
                          setCurrentSection(step);
                        }
                      }}
                      disabled={step > 1 && !selectedCompanyId}
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
                        step
                      )}
                    </button>
                    {step < 4 && (
                      <div className={`flex-1 h-0.5 mx-1 ${
                        getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span className={currentSection === 1 ? 'text-arcova-teal font-medium' : ''}>Company</span>
                <span className={currentSection === 2 ? 'text-arcova-teal font-medium' : ''}>Function</span>
                <span className={currentSection === 3 ? 'text-arcova-teal font-medium' : ''}>Seniority</span>
                <span className={currentSection === 4 ? 'text-arcova-teal font-medium' : ''}>Name</span>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <form onSubmit={handleSave}>
                {/* Section 1: Select Company Profile */}
                {currentSection === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Who is your ideal contact?</h2>
                      <p className="text-sm text-gray-500 mb-4">Select a company profile to define contacts for.</p>
                    </div>

                    {loadingProfiles ? (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal"></div>
                      </div>
                    ) : companyProfiles.length === 0 ? (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No company profiles yet</h3>
                        <p className="text-gray-500 mb-4">Create a company profile first to define contacts for it.</p>
                        <button
                          type="button"
                          onClick={() => router.push('/companies/new')}
                          className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                        >
                          Create company profile
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {companyProfiles.map((company) => (
                          <button
                            key={company.id}
                            type="button"
                            onClick={() => handleSelectCompany(company.id)}
                            className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                              selectedCompanyId === company.id
                                ? 'border-arcova-teal bg-arcova-teal/5'
                                : 'border-gray-200 hover:border-arcova-teal/50'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-semibold text-gray-900">{company.name}</h3>
                                <p className="text-sm text-gray-600 mt-1">{company.company_type}</p>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {company.therapeutic_areas?.slice(0, 2).map((area) => (
                                    <span key={area} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                                      {area}
                                    </span>
                                  ))}
                                  {company.funding_stages?.slice(0, 1).map((stage) => (
                                    <span key={stage} className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                                      {stage}
                                    </span>
                                  ))}
                                  {company.company_sizes?.slice(0, 1).map((size) => (
                                    <span key={size} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                                      {size} employees
                                    </span>
                                  ))}
                                </div>
                              </div>
                              {selectedCompanyId === company.id && (
                                <div className="ml-3 flex-shrink-0">
                                  <div className="w-6 h-6 bg-arcova-teal rounded-full flex items-center justify-center">
                                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Section 2: Function */}
                {currentSection === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">
                        Which functions do you want to reach at {selectedCompany?.name || 'this company type'}?
                      </h2>
                      <p className="text-sm text-gray-500 mb-4">
                        We've pre-selected based on your company profile and target customers. Select up to 5.
                      </p>
                    </div>

                    {isGeneratingFunctions ? (
                      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-arcova-teal"></div>
                        <span>Analyzing your company profile...</span>
                      </div>
                    ) : (
                      <>
                        {/* Selected functions displayed as draggable, prioritized pills */}
                        {formData.functions.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500">Drag to reorder by priority (1 = highest)</p>
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handleFunctionDragEnd}
                            >
                              <SortableContext
                                items={formData.functions}
                                strategy={horizontalListSortingStrategy}
                              >
                                <div className="flex flex-wrap gap-2">
                                  {formData.functions.map((func, index) => (
                                    <div key={func} className="flex items-center gap-1">
                                      <span className="text-xs text-gray-400 font-medium w-4">{index + 1}.</span>
                                      <SortableFunctionPill
                                        id={func}
                                        name={func}
                                        onRemove={() => handleFunctionToggle(func)}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          </div>
                        )}

                        {/* See all functions toggle */}
                        <button
                          type="button"
                          onClick={() => setShowAllFunctions(!showAllFunctions)}
                          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                        >
                          {showAllFunctions ? 'Hide all functions' : 'See all functions'}
                          <svg
                            className={`w-4 h-4 transition-transform ${showAllFunctions ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* All functions (collapsible) */}
                        {showAllFunctions && (
                          <div className="space-y-4 pt-2 border-t border-gray-200">
                            <div className="flex flex-wrap gap-2">
                              {FUNCTION_OPTIONS.map((func) => {
                                const isSelected = formData.functions.includes(func);
                                const isDisabled = !isSelected && formData.functions.length >= 5;
                                return (
                                  <button
                                    key={func}
                                    type="button"
                                    onClick={() => handleFunctionToggle(func)}
                                    disabled={isDisabled}
                                    className={`px-4 py-2 rounded-full text-sm transition-colors ${
                                      isSelected
                                        ? 'bg-arcova-teal text-white'
                                        : isDisabled
                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
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
                              <label className="text-sm text-gray-600 mb-2 block">Other function not listed?</label>
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
                                  placeholder="Enter custom function"
                                  disabled={formData.functions.length >= 5}
                                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm disabled:bg-gray-100 disabled:text-gray-400"
                                />
                                <button
                                  type="button"
                                  onClick={handleAddCustomFunction}
                                  disabled={!customFunction.trim() || formData.functions.length >= 5}
                                  className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50 text-sm"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <p className="text-xs text-gray-500 mt-2">
                      {formData.functions.length}/5 selected
                    </p>
                  </div>
                )}

                {/* Section 3: Seniority */}
                {currentSection === 3 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which seniority levels are worth your time?</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        We've pre-selected based on your company profile and functions.
                      </p>
                    </div>

                    {isGeneratingSeniority ? (
                      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-arcova-teal"></div>
                        <span>Analyzing best seniority levels...</span>
                      </div>
                    ) : (
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
                    )}
                  </div>
                )}

                {/* Section 4: Name */}
                {currentSection === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Name this contact profile</h2>
                      <p className="text-sm text-gray-500 mb-4">We've suggested a name based on your selections. Feel free to edit it.</p>
                    </div>

                    {isGeneratingName ? (
                      <div className="flex items-center gap-2 text-gray-500 py-4">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-arcova-teal"></div>
                        <span>Generating name...</span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., VP-level BD at Series A Oncology Biotech"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                      />
                    )}

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
                      if (currentSection > 1) setCurrentSection(currentSection - 1);
                    }}
                    className={`px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors ${
                      currentSection === 1 ? 'invisible' : ''
                    }`}
                  >
                    Back
                  </button>
                  
                  {currentSection < 4 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleNext();
                      }}
                      disabled={
                        (currentSection === 1 && !selectedCompanyId) ||
                        (currentSection === 2 && formData.functions.length === 0) ||
                        isGeneratingFunctions ||
                        isGeneratingSeniority
                      }
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSaving || isGeneratingName}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Saving...
                        </>
                      ) : (
                        'Save'
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

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md mx-4 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Contact profile saved</h2>
            <p className="text-gray-600 mb-6">
              We'll use this to find the right people at your target companies.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => {
                  setShowSuccessModal(false);
                  setCurrentSection(1);
                  setSelectedCompanyId(null);
                  setFormData({ name: '', functions: [], seniorityLevels: [] });
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Add another profile
              </button>
              <button
                onClick={() => router.push('/contacts')}
                className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors flex items-center justify-center gap-1"
              >
                View all contacts
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
