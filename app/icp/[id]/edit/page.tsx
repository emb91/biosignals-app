'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { getDisplayName } from '@/lib/auth-helpers';
import { toast, Toaster } from 'sonner';

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
  "Microbiome", "Biosimilar", "Vaccine"
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

export default function ICPEditPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const icpId = params.id as string;
  const firstName = user ? getDisplayName(user) : '';

  const [currentSection, setCurrentSection] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    companyType: '',
    therapeuticAreas: [] as string[],
    modalities: [] as string[],
    developmentStages: [] as string[],
    companySizes: [] as string[],
    fundingStages: [] as string[],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [loadingIcp, setLoadingIcp] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const loadICP = async () => {
      if (!user || !icpId) return;

      try {
        const response = await fetch(`/api/icp/${icpId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            const data = result.data;
            setFormData({
              name: data.name || '',
              companyType: data.company_type || '',
              therapeuticAreas: data.therapeutic_areas || [],
              modalities: data.modalities || [],
              developmentStages: data.development_stages || [],
              companySizes: data.company_sizes || [],
              fundingStages: data.funding_stages || [],
            });
          }
        } else {
          toast.error('ICP not found');
          router.push('/icp');
        }
      } catch (error) {
        console.error('Error loading ICP:', error);
        toast.error('Failed to load ICP');
        router.push('/icp');
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
      const response = await fetch(`/api/icp/${icpId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to save ICP');
      }

      toast.success('ICP updated successfully');
      router.push('/icp');
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
      default: return 'incomplete';
    }
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
                {[1, 2, 3, 4, 5].map((step) => (
                  <div key={step} className="flex items-center">
                    <button
                      onClick={() => setCurrentSection(step)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                        currentSection === step
                          ? 'bg-arcova-teal text-white'
                          : getSectionStatus(step) === 'complete'
                          ? 'bg-arcova-teal/20 text-arcova-teal'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {getSectionStatus(step) === 'complete' && currentSection !== step ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        step
                      )}
                    </button>
                    {step < 5 && (
                      <div className={`w-12 md:w-20 h-0.5 mx-1 ${
                        getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span className={currentSection === 1 ? 'text-arcova-teal font-medium' : ''}>Company</span>
                <span className={currentSection === 2 ? 'text-arcova-teal font-medium' : ''}>Size</span>
                <span className={currentSection === 3 ? 'text-arcova-teal font-medium' : ''}>Focus</span>
                <span className={currentSection === 4 ? 'text-arcova-teal font-medium' : ''}>Stage</span>
                <span className={currentSection === 5 ? 'text-arcova-teal font-medium' : ''}>Funding</span>
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
                      <p className="text-sm text-gray-500 mb-4">Choose one — create separate profiles for different customer types later.</p>
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
                  <div className="space-y-6">
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

                    {/* ICP Name - shown on last section */}
                    <div className="pt-4 border-t border-gray-200">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name this ICP <span className="text-red-500">*</span>
                      </label>
                      <p className="text-sm text-gray-500 mb-2">Give it a memorable name so you can identify it later.</p>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. Early Stage Oncology Biotech"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => currentSection === 1 ? router.push('/icp') : setCurrentSection(currentSection - 1)}
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                  >
                    {currentSection === 1 ? 'Cancel' : 'Back'}
                  </button>
                  
                  {currentSection < 5 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (currentSection === 1 && !formData.companyType) {
                          toast.error('Please select a company type');
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
