'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
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

const COMPANY_TYPE_OPTIONS = [
  { value: "Biotech / Biopharma", description: "Early to mid-stage companies developing novel therapeutics" },
  { value: "Pharma", description: "Large established pharmaceutical companies" },
  { value: "Academic Spinout", description: "University-originated companies and research institutes" },
  { value: "CDMO", description: "Contract development and manufacturing organisations" },
  { value: "CRO", description: "Contract research organisations" },
  { value: "Medical Device", description: "Device and diagnostics companies" },
];

const THERAPEUTIC_AREA_OPTIONS = [
  "Oncology", "Rare Disease", "Neuroscience", "Immunology", "Cardiovascular",
  "Infectious Disease", "Metabolic Disease", "Cell & Gene Therapy",
  "RNA/Oligonucleotides", "Ophthalmology", "Other"
];

const MODALITY_OPTIONS = [
  "Small Molecule", "Biologic (Antibody)", "Bispecific Antibody", "ADC",
  "Cell Therapy", "Gene Therapy", "RNA Therapy", "Peptide", "Oligonucleotide",
  "Radiopharmaceutical", "Protein / Enzyme Replacement", "Gene Editing (CRISPR)",
  "Microbiome", "Biosimilar", "Vaccine",
  "Diagnostics", "Liquid Biopsy", "Digital Therapeutics",
  "Drug Discovery Platform", "Biomarker", "Imaging"
];

const DEVELOPMENT_STAGE_OPTIONS = [
  "Preclinical", "Phase I", "Phase II", "Phase III", "Commercial", "All stages"
];

const COMPANY_SIZE_OPTIONS = [
  "1–10", "11–50", "51–200", "201–500", "500+"
];

const FUNDING_STAGE_OPTIONS = [
  "Pre-seed", "Seed", "Series A", "Series B", "Series C", "Series D+", "Public", "Grant-funded"
];

interface SortableSignalPillProps {
  id: string;
  name: string;
  onRemove: () => void;
}

function SortableSignalPill({ id, name, onRemove }: SortableSignalPillProps) {
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
      {/* Drag handle - only this part is draggable */}
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

export default function ICPEditPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const icpId = params.id as string;
  const firstName = user ? getDisplayName(user) : '';

  interface ExampleCompany {
    url: string;
    companyName: string;
    therapeuticArea?: string | null;
    modality?: string | string[] | null;
    fundingStage?: string | null;
    companySize?: string | null;
    developmentStage?: string | null;
    companyType?: string | null;
  }

  interface Signal {
    id: string;
    name: string;
    category: string;
  }

  const [currentSection, setCurrentSection] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    companyType: '',
    therapeuticAreas: [] as string[],
    modalities: [] as string[],
    developmentStages: [] as string[],
    companySizes: [] as string[],
    fundingStages: [] as string[],
    signals: [] as string[],
    exampleCompanies: [] as ExampleCompany[],
  });
  const [companyUrl, setCompanyUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [loadingIcp, setLoadingIcp] = useState(true);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isAnalyzingCompany, setIsAnalyzingCompany] = useState(false);
  const [isLoadingSignals, setIsLoadingSignals] = useState(false);
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [showAllSignals, setShowAllSignals] = useState(false);

  const generateName = async () => {
    setIsGeneratingName(true);
    try {
      const response = await fetch('/api/generate-icp-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const result = await response.json();
        setFormData(prev => ({ ...prev, name: result.name }));
        toast.success('Name generated!');
      } else {
        toast.error('Failed to generate name');
      }
    } catch (error) {
      console.error('Error generating name:', error);
      toast.error('Failed to generate name');
    } finally {
      setIsGeneratingName(false);
    }
  };

  const loadSignals = async (existingSignals?: string[]) => {
    setIsLoadingSignals(true);
    try {
      // First, always fetch the full list of signals
      const response = await fetch('/api/recommend-signals');
      if (response.ok) {
        const result = await response.json();
        setAllSignals(result.all || []);
      }
      
      // If we have existing signals (from loaded ICP), use those
      // Otherwise, get recommendations
      if (!existingSignals || existingSignals.length === 0) {
        const recResponse = await fetch('/api/recommend-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (recResponse.ok) {
          const recResult = await recResponse.json();
          const recommendedIds = (recResult.recommended || []).map((s: Signal) => s.id);
          setFormData(prev => ({ ...prev, signals: recommendedIds }));
        }
      }
    } catch (error) {
      console.error('Error loading signals:', error);
    } finally {
      setIsLoadingSignals(false);
    }
  };

  const handleSignalToggle = (signalId: string) => {
    setFormData(prev => ({
      ...prev,
      signals: prev.signals.includes(signalId)
        ? prev.signals.filter(id => id !== signalId)
        : [...prev.signals, signalId]
    }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setFormData(prev => {
        const oldIndex = prev.signals.indexOf(active.id as string);
        const newIndex = prev.signals.indexOf(over.id as string);
        
        return {
          ...prev,
          signals: arrayMove(prev.signals, oldIndex, newIndex),
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
    const loadICP = async () => {
      if (!user || !icpId) return;

      try {
        const response = await fetch(`/api/companies/${icpId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            const data = result.data;
            // Parse stored company JSON strings back to objects
            const storedCompanies = data.example_companies || [];
            const exampleCompanies: ExampleCompany[] = storedCompanies.map((item: string) => {
              try {
                // Try to parse as JSON (new format with full data)
                return JSON.parse(item);
              } catch {
                // Fallback for old format (just company name string)
                return { url: '', companyName: item };
              }
            });
            
// Parse stored signals - they may be JSON strings with weights or plain IDs
            const storedSignals = data.signals || [];
            const loadedSignals = storedSignals.map((item: string) => {
              try {
                const parsed = JSON.parse(item);
                return parsed.id || item; // Extract ID from weighted signal object
              } catch {
                return item; // Plain string ID (backward compatibility)
              }
            });

            setFormData({
              name: data.name || '',
              companyType: data.company_type || '',
              therapeuticAreas: data.therapeutic_areas || [],
              modalities: data.modalities || [],
              developmentStages: data.development_stages || [],
              companySizes: data.company_sizes || [],
              fundingStages: data.funding_stages || [],
              signals: loadedSignals,
              exampleCompanies,
            });
            
            // Load all signals list
            loadSignals(loadedSignals);
          }
        } else {
          toast.error('ICP not found');
          router.push('/companies');
        }
      } catch (error) {
        console.error('Error loading ICP:', error);
        toast.error('Failed to load ICP');
        router.push('/companies');
      } finally {
        setLoadingIcp(false);
      }
    };

    if (user) {
      loadICP();
    }
  }, [user, icpId, router]);

  const handleMultiSelect = (field: 'therapeuticAreas' | 'modalities' | 'developmentStages' | 'companySizes' | 'fundingStages', value: string) => {
    const currentArray = formData[field];
    
    if (currentArray.includes(value)) {
      setFormData(prev => ({
        ...prev,
        [field]: currentArray.filter(item => item !== value)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: [...currentArray, value]
      }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.companyType) {
      toast.error('Please select a company type');
      setCurrentSection(1);
      return;
    }

    if (!formData.name.trim()) {
      toast.error('Please enter an ICP name');
      return;
    }

    if (!user) return;

    setIsSaving(true);

    try {
      // Store full analyzed company data as JSON strings
      const dataToSave = {
        ...formData,
        exampleCompanies: formData.exampleCompanies.map(c => JSON.stringify(c)),
      };
      
      const response = await fetch(`/api/companies/${icpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave),
      });

      if (!response.ok) {
        throw new Error('Failed to save ICP');
      }

      toast.success('ICP updated successfully');
      router.push('/companies');
    } catch (error) {
      console.error('Error saving ICP:', error);
      toast.error('Failed to save ICP. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSectionStatus = (section: number) => {
    switch (section) {
      case 1: return formData.companyType ? 'complete' : 'incomplete';
      case 2: return formData.companySizes.length > 0 ? 'complete' : 'incomplete';
      case 3: return (formData.therapeuticAreas.length > 0 || formData.modalities.length > 0) ? 'complete' : 'incomplete';
      case 4: return formData.developmentStages.length > 0 ? 'complete' : 'incomplete';
      case 5: return formData.fundingStages.length > 0 ? 'complete' : 'incomplete';
      case 6: return formData.name ? 'complete' : 'incomplete';
      case 7: return formData.signals.length > 0 ? 'complete' : 'incomplete';
      case 8: return formData.exampleCompanies.length > 0 ? 'complete' : 'incomplete';
      default: return 'incomplete';
    }
  };

  const handleAddCompany = async () => {
    let url = companyUrl.trim();
    if (!url) return;
    
    // Add https:// if no protocol specified
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    if (formData.exampleCompanies.some(c => c.url === url || c.companyName === url)) {
      toast.error('Company already added');
      return;
    }
    if (formData.exampleCompanies.length >= 3) {
      toast.error('Maximum 3 companies');
      return;
    }

    setIsAnalyzingCompany(true);
    
    try {
      const response = await fetch('/api/analyze-example-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze company');
      }

      const data = await response.json();
      
      const newCompany: ExampleCompany = {
        url,
        companyName: data.companyName || url.replace(/^https?:\/\//, '').split('/')[0],
        therapeuticArea: data.therapeuticArea,
        modality: data.modality,
        fundingStage: data.fundingStage,
        companySize: data.companySize,
        developmentStage: data.developmentStage,
        companyType: data.companyType,
      };

      setFormData(prev => ({
        ...prev,
        exampleCompanies: [...prev.exampleCompanies, newCompany]
      }));
      setCompanyUrl('');
      toast.success(`Added ${newCompany.companyName}`);
    } catch (error) {
      console.error('Error analyzing company:', error);
      toast.error('Failed to analyze company. Please try again.');
    } finally {
      setIsAnalyzingCompany(false);
    }
  };

  const handleRemoveCompany = (identifier: string) => {
    setFormData(prev => ({
      ...prev,
      exampleCompanies: prev.exampleCompanies.filter(c => c.url !== identifier && c.companyName !== identifier)
    }));
  };

  if (loading || loadingIcp) {
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
      
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top Bar */}
        <div className="bg-gray-50 px-6 py-3 flex-shrink-0">
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
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-3xl mx-auto">
            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((step) => (
                  <div key={step} className="flex items-center">
                    <button
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
                        step
                      )}
                    </button>
                    {step < 8 && (
                      <div className={`w-4 md:w-8 h-0.5 mx-0.5 ${
                        getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span className={currentSection === 1 ? 'text-arcova-teal font-medium' : ''}>Type</span>
                <span className={currentSection === 2 ? 'text-arcova-teal font-medium' : ''}>Size</span>
                <span className={currentSection === 3 ? 'text-arcova-teal font-medium' : ''}>Focus</span>
                <span className={currentSection === 4 ? 'text-arcova-teal font-medium' : ''}>Stage</span>
                <span className={currentSection === 5 ? 'text-arcova-teal font-medium' : ''}>Funding</span>
                <span className={currentSection === 6 ? 'text-arcova-teal font-medium' : ''}>Name</span>
                <span className={currentSection === 7 ? 'text-arcova-teal font-medium' : ''}>Signals</span>
                <span className={currentSection === 8 ? 'text-arcova-teal font-medium' : ''}>Examples</span>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <form onSubmit={handleSave}>
                {/* Section 1: Company Type */}
                {currentSection === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Who do you sell to?</h2>
                      <p className="text-sm text-gray-500 mb-4">Choose one. Create separate profiles for different customer types later.</p>
                    </div>
                    <div className="space-y-3">
                      {COMPANY_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, companyType: option.value }))}
                          className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                            formData.companyType === option.value
                              ? 'border-arcova-teal bg-arcova-teal/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className={`font-medium ${formData.companyType === option.value ? 'text-arcova-teal' : 'text-gray-900'}`}>
                            {option.value}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">{option.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 2: Company Size */}
                {currentSection === 2 && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">How large are the companies you usually sell to?</h2>
                    <p className="text-sm text-gray-500 mb-4">Select all that apply.</p>
                    <div className="flex flex-wrap gap-2">
                      {COMPANY_SIZE_OPTIONS.map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => handleMultiSelect('companySizes', size)}
                          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                            formData.companySizes.includes(size)
                              ? 'bg-arcova-teal text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 3: Therapeutic Areas & Modalities */}
                {currentSection === 3 && (
                  <div className="space-y-6">
                    {/* Therapeutic Areas */}
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Therapeutic Area</h2>
                      <p className="text-sm text-gray-500 mb-4">Select all that apply.</p>
                      <div className="flex flex-wrap gap-2">
                        {THERAPEUTIC_AREA_OPTIONS.map((area) => (
                          <button
                            key={area}
                            type="button"
                            onClick={() => handleMultiSelect('therapeuticAreas', area)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                              formData.therapeuticAreas.includes(area)
                                ? 'bg-arcova-teal text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {area}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Modalities */}
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Modality</h2>
                      <p className="text-sm text-gray-500 mb-4">Select all that apply.</p>
                      <div className="flex flex-wrap gap-2">
                        {MODALITY_OPTIONS.map((modality) => (
                          <button
                            key={modality}
                            type="button"
                            onClick={() => handleMultiSelect('modalities', modality)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                              formData.modalities.includes(modality)
                                ? 'bg-arcova-teal text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {modality}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 4: Development Stage */}
                {currentSection === 4 && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Development stage</h2>
                    <p className="text-sm text-gray-500 mb-4">Which stages are most relevant to you?</p>
                    <div className="flex flex-wrap gap-2">
                      {DEVELOPMENT_STAGE_OPTIONS.map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => handleMultiSelect('developmentStages', stage)}
                          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                            formData.developmentStages.includes(stage)
                              ? 'bg-arcova-teal text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {stage}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 5: Funding Stage */}
                {currentSection === 5 && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Funding stage</h2>
                    <p className="text-sm text-gray-500 mb-4">Select all that apply.</p>
                    <div className="flex flex-wrap gap-2">
                      {FUNDING_STAGE_OPTIONS.map((stage) => (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => handleMultiSelect('fundingStages', stage)}
                          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                            formData.fundingStages.includes(stage)
                              ? 'bg-arcova-teal text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {stage}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Section 6: ICP Name */}
                {currentSection === 6 && (
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 mb-1">Name this ICP</h2>
                    <p className="text-sm text-gray-500 mb-4">Give it a memorable name so you can identify it later.</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Early Stage Oncology Biotech"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm"
                      />
                      <button
                        type="button"
                        onClick={generateName}
                        disabled={isGeneratingName}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
                      >
                        {isGeneratingName ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                            <span>Generating...</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Generate</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

{/* Section 7: Signals */}
                {currentSection === 7 && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which signals matter most to you?</h2>
                      <p className="text-sm text-gray-500">We track all buying signals in the background. Tell us which ones you trust most so we can learn your preferences over time. Not sure? Leave our suggestions as they are. You can update this any time.</p>
                    </div>

                    {isLoadingSignals ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal"></div>
                        <span className="ml-3 text-sm text-gray-500">Loading signals...</span>
                      </div>
                    ) : (
                      <>
                        {/* Selected signals - drag to reorder zone */}
                        <div className="bg-gray-50 rounded-lg p-4 border-2 border-dashed border-gray-200 min-h-[80px]">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-gray-600">Your priority signals (drag to reorder)</p>
                            <p className="text-xs text-gray-500">{formData.signals.length}/5 selected</p>
                          </div>
                          {formData.signals.length > 0 ? (
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={handleDragEnd}
                            >
                              <SortableContext
                                items={formData.signals}
                                strategy={horizontalListSortingStrategy}
                              >
                                <div className="flex flex-wrap gap-2">
                                  {formData.signals.map((signalId, index) => {
                                    const signal = allSignals.find(s => s.id === signalId);
                                    if (!signal) return null;
                                    return (
                                      <div key={signalId} className="flex items-center gap-1">
                                        <span className="text-xs text-gray-400 font-medium w-4">{index + 1}.</span>
                                        <SortableSignalPill
                                          id={signalId}
                                          name={signal.name}
                                          onRemove={() => handleSignalToggle(signalId)}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </SortableContext>
                            </DndContext>
                          ) : (
                            <p className="text-sm text-gray-400 italic">Select signals from below</p>
                          )}
                        </div>

                        {/* See all signals toggle */}
                        <button
                          type="button"
                          onClick={() => setShowAllSignals(!showAllSignals)}
                          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                        >
                          {showAllSignals ? 'Hide all signals' : 'See all signals'}
                          <svg
                            className={`w-4 h-4 transition-transform ${showAllSignals ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {/* All signals grouped by category (collapsible) */}
                        {showAllSignals && (
                          <div className="space-y-4 pt-2 border-t border-gray-200">
                            {['Funding & Financial', 'Pipeline & Clinical', 'Hiring & Team', 'Corporate & Strategic'].map((category) => (
                              <div key={category}>
                                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{category}</h4>
                                <div className="flex flex-wrap gap-2">
                                  {allSignals
                                    .filter(s => s.category === category)
                                    .map((signal) => {
                                      const isSelected = formData.signals.includes(signal.id);
                                      const isDisabled = !isSelected && formData.signals.length >= 5;
                                      return (
                                        <button
                                          key={signal.id}
                                          type="button"
                                          onClick={() => !isDisabled && handleSignalToggle(signal.id)}
                                          disabled={isDisabled}
                                          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                                            isSelected
                                              ? 'bg-arcova-teal text-white'
                                              : isDisabled
                                              ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                          }`}
                                        >
                                          {signal.name}
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Section 8: Example Companies */}
                {currentSection === 8 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Show us your best customers</h2>
                      <p className="text-sm text-gray-500 mb-4">Add up to 3 companies that match this profile. We'll analyze each one to fine-tune your lead scoring.</p>
                      <div className="bg-arcova-teal/10 border border-arcova-teal/20 rounded-lg p-3 mb-4">
                        <p className="text-sm text-arcova-teal font-medium">Companies that complete this step get 40% more relevant leads</p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={companyUrl}
                        onChange={(e) => setCompanyUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAddCompany();
                          }
                        }}
                        placeholder="Enter company website (e.g., company.com)"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm"
                        disabled={formData.exampleCompanies.length >= 3 || isAnalyzingCompany}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAddCompany();
                        }}
                        disabled={formData.exampleCompanies.length >= 3 || isAnalyzingCompany || !companyUrl.trim()}
                        className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors text-sm disabled:opacity-50 flex items-center gap-2 min-w-[80px] justify-center"
                      >
                        {isAnalyzingCompany ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          </>
                        ) : (
                          'Add'
                        )}
                      </button>
                    </div>

                    {isAnalyzingCompany && (
                      <p className="text-sm text-arcova-teal">Analyzing company...</p>
                    )}

                    {formData.exampleCompanies.length > 0 && (
                      <div className="space-y-3 mt-4">
                        {formData.exampleCompanies.map((company, index) => (
                          <div
                            key={index}
                            className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h3 className="font-medium text-gray-900">{company.companyName}</h3>
                                {company.url && <p className="text-xs text-gray-400 mt-0.5">{company.url}</p>}
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {company.therapeuticArea && (
                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                                      {company.therapeuticArea}
                                    </span>
                                  )}
                                  {company.modality && (
                                    Array.isArray(company.modality) 
                                      ? company.modality.map((mod, i) => (
                                          <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                                            {mod}
                                          </span>
                                        ))
                                      : (
                                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                                            {company.modality}
                                          </span>
                                        )
                                  )}
                                  {company.fundingStage && (
                                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                                      {company.fundingStage}
                                    </span>
                                  )}
                                  {company.companySize && (
                                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs">
                                      {company.companySize} employees
                                    </span>
                                  )}
                                  {company.developmentStage && (
                                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs">
                                      {company.developmentStage}
                                    </span>
                                  )}
                                  {company.companyType && (
                                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs">
                                      {company.companyType}
                                    </span>
                                  )}
                                  {!company.therapeuticArea && (!company.modality || (Array.isArray(company.modality) && company.modality.length === 0)) && !company.fundingStage && !company.companySize && !company.developmentStage && !company.companyType && !company.url && (
                                    <span className="text-xs text-gray-400 italic">Previously saved</span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveCompany(company.url || company.companyName)}
                                className="text-gray-400 hover:text-red-500 transition-colors ml-2"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {formData.exampleCompanies.length === 0 && !isAnalyzingCompany && (
                      <p className="text-sm text-gray-400 italic">No companies added yet.</p>
                    )}

                    <div className="mt-4">
                      <p className="text-xs text-gray-500">
                        {formData.exampleCompanies.length}/3 companies added
                      </p>
                    </div>
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentSection === 1) {
                        router.push('/companies');
                      } else {
                        setCurrentSection(currentSection - 1);
                      }
                    }}
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                  >
                    {currentSection === 1 ? 'Cancel' : 'Back'}
                  </button>
                  
                  {currentSection < 8 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (currentSection === 1 && !formData.companyType) {
                          toast.error('Please select a company type');
                          return;
                        }
                        if (currentSection === 6 && !formData.name.trim()) {
                          toast.error('Please enter an ICP name');
                          return;
                        }
                        setCurrentSection(currentSection + 1);
                      }}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors text-sm"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm"
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
    </div>
  );
}
