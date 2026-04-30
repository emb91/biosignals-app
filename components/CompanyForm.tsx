'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
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
import { getSignalDisplayName } from '@/lib/signal-display-names';
import { getRandomLockedSignals, type LockedSignal } from '@/lib/locked-signals';
import {
  COMPANY_SIZE_OPTIONS,
  LI_FOLLOWER_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  MODALITY_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
} from '@/lib/arcova-taxonomy';

// --- Constants ---

const EXPLICIT_DEVELOPMENT_STAGE_OPTIONS = DEVELOPMENT_STAGE_OPTIONS.filter(
  (stage) => stage !== 'All stages'
);
const CAL_BOOKING_URL = 'https://cal.com/emma-arcova/45-min-meeting';

// --- Types ---

export interface ExampleCompany {
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

export interface CompanyFormData {
  name: string;
  companyType: string;
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  /** Beachhead taxonomy — stored separately from own TA/modality */
  customerTherapeuticAreas: string[];
  customerModalities: string[];
  customerDevelopmentStages: string[];
  companySizes: string[];
  liFollowerSizes: string[];
  fundingStages: string[];
  signals: string[];
  exampleCompanies: ExampleCompany[];
}

interface CompanyFormProps {
  mode: 'create' | 'edit';
  initialData?: CompanyFormData;
  onSave: (data: CompanyFormData) => Promise<void>;
  onCancel: () => void;
}

// --- SortableSignalPill ---

function SortableSignalPill({ id, name, onRemove }: { id: string; name: string; onRemove: () => void }) {
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

// --- Default form data ---

const DEFAULT_FORM_DATA: CompanyFormData = {
  name: '',
  companyType: '',
  therapeuticAreas: [],
  modalities: [],
  developmentStages: [],
  customerTherapeuticAreas: [],
  customerModalities: [],
  customerDevelopmentStages: [],
  companySizes: [],
  liFollowerSizes: [],
  fundingStages: [],
  signals: [],
  exampleCompanies: [],
};

function normalizeDevelopmentStages(stages: string[] | undefined): string[] {
  if (!stages || stages.length === 0) return [];
  if (stages.includes('All stages')) return [...EXPLICIT_DEVELOPMENT_STAGE_OPTIONS];
  return stages;
}

const ENGAGEMENT_LOCKED_SIGNAL_IDS = [
  'attended_your_webinar_or_event',
  'visited_your_website',
  'downloaded_your_content',
  'clicked_your_linkedin_ad',
  'demo_requested',
  'inbound_enquiry',
];

const CRM_LOCKED_SIGNAL_IDS = [
  'previously_contacted_by_your_team',
  'meeting_previously_booked',
  'renewal_coming_up',
  'lapsed_customer',
  'open_opportunity_in_crm',
  'responded_to_a_previous_outreach',
];

// --- Main Component ---

export default function CompanyForm({ mode, initialData, onSave, onCancel }: CompanyFormProps) {
  const [currentSection, setCurrentSection] = useState(1);
  const [formData, setFormData] = useState<CompanyFormData>(
    initialData
      ? {
          ...DEFAULT_FORM_DATA,
          ...initialData,
          developmentStages: normalizeDevelopmentStages(initialData.developmentStages),
        }
      : DEFAULT_FORM_DATA
  );
  const [companyUrl, setCompanyUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isAnalyzingCompany, setIsAnalyzingCompany] = useState(false);
  const [isLoadingSignals, setIsLoadingSignals] = useState(false);
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [lockedSignals] = useState<LockedSignal[]>(() => getRandomLockedSignals(undefined, 'company'));
  const [lockedSignalModal, setLockedSignalModal] = useState<LockedSignal | null>(null);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const lockedSignalById = useMemo(
    () => new Map(lockedSignals.map((signal) => [signal.id, signal])),
    [lockedSignals]
  );
  const engagementLockedSignals = useMemo(
    () =>
      ENGAGEMENT_LOCKED_SIGNAL_IDS.map((id) => lockedSignalById.get(id)).filter(
        (signal): signal is LockedSignal => Boolean(signal)
      ),
    [lockedSignalById]
  );
  const crmLockedSignals = useMemo(
    () =>
      CRM_LOCKED_SIGNAL_IDS.map((id) => lockedSignalById.get(id)).filter(
        (signal): signal is LockedSignal => Boolean(signal)
      ),
    [lockedSignalById]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // --- Signal loading (unified for create + edit) ---

  const loadSignals = async () => {
    if (allSignals.length > 0) return;

    setIsLoadingSignals(true);
    try {
      if (formData.signals.length > 0) {
        // Edit mode with existing selections: just load the catalog
        const response = await fetch('/api/recommend-signals');
        if (response.ok) {
          const result = await response.json();
          setAllSignals(result.all || []);
        }
      } else {
        // No selections yet: get AI recommendations
        const response = await fetch('/api/recommend-signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (response.ok) {
          const result = await response.json();
          setAllSignals(result.all || []);
          const recommendedIds = (result.recommended || []).map((s: Signal) => s.id);
          setFormData(prev => ({ ...prev, signals: recommendedIds }));
        } else {
          const fallbackResponse = await fetch('/api/recommend-signals');
          if (fallbackResponse.ok) {
            const fallback = await fallbackResponse.json();
            setAllSignals(fallback.all || []);
          }
          toast.error('Could not load recommendations, showing all signals');
        }
      }
    } catch (error) {
      console.error('Error loading signals:', error);
      toast.error('Failed to load signals');
    } finally {
      setIsLoadingSignals(false);
    }
  };

  const navigateToSection = async (section: number) => {
    if (section === 6 && !formData.name.trim() && !isGeneratingName) {
      await generateName({ silent: true });
    }
    if (section === 7) loadSignals();
    setCurrentSection(section);
  };

  // --- Handlers ---

  const generateName = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!formData.companyType || isGeneratingName) return;

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
        if (!silent) {
          toast.success('Name generated!');
        }
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

  const handleSignalToggle = (signalId: string) => {
    setFormData(prev => ({
      ...prev,
      signals: prev.signals.includes(signalId)
        ? prev.signals.filter(id => id !== signalId)
        : [...prev.signals, signalId]
    }));
  };

  const handleLockedSignalClick = async (signal: LockedSignal) => {
    setLockedSignalModal(signal);
    try {
      await fetch('/api/locked-signal-clicks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId: signal.id,
          signalName: signal.name,
        }),
      });
    } catch {
      // Intentionally silent background logging.
    }
  };

  const getContactUsUrl = (_signal: LockedSignal) => {
    const details = 'Company enterprise signal request';

    const params = new URLSearchParams({
      notes: details,
      description: details,
    });

    return `${CAL_BOOKING_URL}?${params.toString()}`;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFormData(prev => {
        const oldIndex = prev.signals.indexOf(active.id as string);
        const newIndex = prev.signals.indexOf(over.id as string);
        return { ...prev, signals: arrayMove(prev.signals, oldIndex, newIndex) };
      });
    }
  };

  const handleMultiSelect = (field: 'therapeuticAreas' | 'modalities' | 'developmentStages' | 'companySizes' | 'liFollowerSizes' | 'fundingStages', value: string) => {
    if (field === 'developmentStages') {
      const currentArray = normalizeDevelopmentStages(formData.developmentStages);

      if (value === 'All stages') {
        const allSelected = EXPLICIT_DEVELOPMENT_STAGE_OPTIONS.every((stage) => currentArray.includes(stage));
        setFormData((prev) => ({
          ...prev,
          developmentStages: allSelected ? [] : [...EXPLICIT_DEVELOPMENT_STAGE_OPTIONS],
        }));
        return;
      }

      const nextStages = currentArray.includes(value)
        ? currentArray.filter((item) => item !== value)
        : [...currentArray, value];

      setFormData((prev) => ({
        ...prev,
        developmentStages: nextStages,
      }));
      return;
    }

    const currentArray = formData[field];
    if (currentArray.includes(value)) {
      setFormData(prev => ({ ...prev, [field]: currentArray.filter(item => item !== value) }));
    } else {
      setFormData(prev => ({ ...prev, [field]: [...currentArray, value] }));
    }
  };

  const handleAddCompany = async () => {
    let url = companyUrl.trim();
    if (!url) return;

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

      if (!response.ok) throw new Error('Failed to analyze company');

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

    setIsSaving(true);
    try {
      await onSave(formData);
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
      case 3:
        return formData.therapeuticAreas.length > 0 ||
          formData.modalities.length > 0 ||
          formData.customerTherapeuticAreas.length > 0 ||
          formData.customerModalities.length > 0
          ? 'complete'
          : 'incomplete';
      case 4:
        return formData.developmentStages.length > 0 || formData.customerDevelopmentStages.length > 0
          ? 'complete'
          : 'incomplete';
      case 5: return formData.fundingStages.length > 0 ? 'complete' : 'incomplete';
      case 6: return formData.name ? 'complete' : 'incomplete';
      case 7: return formData.signals.length > 0 ? 'complete' : 'incomplete';
      case 8: return formData.exampleCompanies.length > 0 ? 'complete' : 'incomplete';
      default: return 'incomplete';
    }
  };

  const handleNext = async (e: React.MouseEvent) => {
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
    await navigateToSection(currentSection + 1);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Edit mode banner */}
      {mode === 'edit' && formData.name && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Editing company profile</p>
            <p className="font-medium text-gray-900">{formData.name}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((step) => (
            <div key={step} className="flex items-center">
              <button
                onClick={() => navigateToSection(step)}
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
            <div className="space-y-6">
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
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-1">What LinkedIn follower base do they typically have?</h3>
                <p className="text-sm text-gray-500 mb-4">Select all that apply.</p>
                <div className="flex flex-wrap gap-2">
                  {LI_FOLLOWER_OPTIONS.map((band) => (
                    <button
                      key={band}
                      type="button"
                      onClick={() => handleMultiSelect('liFollowerSizes', band)}
                      className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                        formData.liFollowerSizes.includes(band)
                          ? 'bg-arcova-teal text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {band}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Therapeutic Areas & Modalities */}
          {currentSection === 3 && (
            <div className="space-y-6">
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
                  (() => {
                    const selectedStages = normalizeDevelopmentStages(formData.developmentStages);
                    const isSelected =
                      stage === 'All stages'
                        ? EXPLICIT_DEVELOPMENT_STAGE_OPTIONS.every((option) => selectedStages.includes(option))
                        : selectedStages.includes(stage);

                    return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => handleMultiSelect('developmentStages', stage)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      isSelected
                        ? 'bg-arcova-teal text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {stage}
                  </button>
                    );
                  })()
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
                  onClick={() => generateName()}
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
                <p className="text-sm text-gray-500">We've suggested the most relevant ones based on your profile. You can have up to 5, swap any out by deselecting one and choosing another. You can update this any time.</p>
              </div>

              {isLoadingSignals ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal"></div>
                  <span className="ml-3 text-sm text-gray-500">
                    {formData.signals.length > 0 ? 'Loading signals...' : 'Analyzing your profile...'}
                  </span>
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
                                    name={getSignalDisplayName(signal.id, signal.name)}
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

                  <div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-[#9CA3AF] mb-2">Engagement signals</p>
                        <div className="flex flex-wrap gap-2">
                          {engagementLockedSignals.map((signal) => (
                            <button
                              key={signal.id}
                              type="button"
                              onClick={() => handleLockedSignalClick(signal)}
                              className="px-3 py-1.5 rounded-full text-sm transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              {getSignalDisplayName(signal.id, signal.name)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-[#9CA3AF] mb-2">CRM signals</p>
                        <div className="flex flex-wrap gap-2">
                          {crmLockedSignals.map((signal) => (
                            <button
                              key={signal.id}
                              type="button"
                              onClick={() => handleLockedSignalClick(signal)}
                              className="px-3 py-1.5 rounded-full text-sm transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              {getSignalDisplayName(signal.id, signal.name)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
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
                              .filter(
                                (s) => s.category === category && !formData.signals.includes(s.id)
                              )
                              .map((signal) => {
                                const isDisabled = formData.signals.length >= 5;
                                return (
                                  <button
                                    key={signal.id}
                                    type="button"
                                    onClick={() => {
                                      if (!isDisabled) handleSignalToggle(signal.id);
                                    }}
                                    disabled={isDisabled}
                                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                                      isDisabled
                                        ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    {getSignalDisplayName(signal.id, signal.name)}
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
                  placeholder="Enter company website (e.g. company.com)"
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
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
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
                  onCancel();
                } else {
                  setCurrentSection(currentSection - 1);
                }
              }}
              className={`px-6 py-2 border rounded-lg transition-colors text-sm ${
                mode === 'edit' && currentSection === 1
                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {currentSection === 1 ? 'Cancel' : 'Back'}
            </button>

            <div className="flex items-center gap-2">
              {currentSection < 8 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className={`px-6 py-2 rounded-lg transition-colors text-sm ${
                    mode === 'edit'
                      ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'bg-arcova-teal text-white hover:bg-arcova-teal/90'
                  }`}
                >
                  Next
                </button>
              )}
              {mode === 'edit' || currentSection === 8 ? (
                <button
                  type="submit"
                  disabled={isSaving || !formData.name.trim()}
                  className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    mode === 'edit' ? 'Save' : 'Save'
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </form>
      </div>

      {lockedSignalModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md mx-4 text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              Unlock {lockedSignalModal.name}
            </h2>
            <p className="text-gray-600 mb-6">
              This signal requires a custom integration with your tracking setup or CRM. Get in touch and we'll help you set it up.
            </p>
            <div className="flex flex-col gap-3 items-center">
              <a
                href={getContactUsUrl(lockedSignalModal)}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
              >
                Contact us
              </a>
              <button
                type="button"
                onClick={() => setLockedSignalModal(null)}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
