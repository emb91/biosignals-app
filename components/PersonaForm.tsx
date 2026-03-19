'use client';

import { useState } from 'react';
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

// --- Constants ---

const FUNCTION_OPTIONS = [
  "Executive Leadership",
  "Business Development & Partnerships",
  "Clinical Operations",
  "Research & Development",
  "Regulatory Affairs",
  "Manufacturing & CMC",
  "Medical Affairs",
  "Commercial & Sales Operations",
  "Procurement",
  "Strategy & Corporate Development",
  "Lab Operations",
  "Technology & Systems",
  "AI & Machine Learning",
  "Marketing"
];

const SENIORITY_OPTIONS = [
  "C-Level",
  "VP / SVP",
  "Director",
  "Head of / Senior Manager",
  "Manager",
  "Individual Contributor"
];

const SPECIFIC_ROLE_OPTIONS: Record<string, string[]> = {
  "Executive Leadership": [
    "Chief Executive Officer",
    "President",
    "Founder / Co-Founder",
  ],
  "Business Development & Partnerships": [
    "VP Business Development",
    "Head of Business Development",
    "Director of Business Development",
    "Head of Partnerships",
    "Business Development Manager",
    "Partnerships Manager",
    "Business Development Representative",
  ],
  "Clinical Operations": [
    "VP Clinical Operations",
    "Head of Clinical Operations",
    "Director of Clinical Operations",
    "Clinical Operations Manager",
    "Clinical Trial Manager",
    "Clinical Research Associate",
  ],
  "Research & Development": [
    "Chief Scientific Officer",
    "VP R&D",
    "Director of R&D",
    "Head of Research",
    "Principal Scientist",
    "Senior Scientist",
    "Research Scientist",
    "Associate Scientist",
  ],
  "Regulatory Affairs": [
    "VP Regulatory Affairs",
    "Head of Regulatory Affairs",
    "Director of Regulatory Affairs",
    "Regulatory Affairs Manager",
    "Regulatory Affairs Associate",
  ],
  "Manufacturing & CMC": [
    "Chief Operating Officer",
    "VP Manufacturing",
    "Head of CMC",
    "Director of Manufacturing",
    "Manufacturing Manager",
    "CMC Manager",
    "Process Engineer",
  ],
  "Medical Affairs": [
    "Chief Medical Officer",
    "VP Medical Affairs",
    "Head of Medical Affairs",
    "Director of Medical Affairs",
    "Medical Science Liaison (MSL)",
    "Medical Affairs Manager",
  ],
  "Commercial & Sales Operations": [
    "Chief Commercial Officer",
    "Chief Revenue Officer",
    "VP Sales",
    "VP Commercial",
    "Head of Sales",
    "Sales Director",
    "Sales Manager",
    "Account Manager",
    "Account Executive",
    "Sales Representative",
  ],
  "Procurement": [
    "Head of Procurement",
    "Director of Procurement",
    "Procurement Manager",
    "Vendor Manager",
    "Head of Outsourcing",
    "Alliance Manager",
  ],
  "Strategy & Corporate Development": [
    "Chief Financial Officer",
    "VP Strategy",
    "Head of Corporate Development",
    "Director of Strategy",
    "Strategy Manager",
    "Corporate Development Manager",
    "Strategy Analyst",
  ],
  "Lab Operations": [
    "Head of Lab Operations",
    "Director of Lab Operations",
    "Lab Manager",
    "Senior Lab Manager",
    "Laboratory Supervisor",
    "Lab Operations Manager",
    "Facilities Manager",
    "Equipment Manager",
  ],
  "Technology & Systems": [
    "Chief Technology Officer",
    "VP of Technology",
    "VP Engineering",
    "Director of IT",
    "Head of Informatics",
    "Director of Bioinformatics",
    "Head of Data Science",
    "Engineering Manager",
    "Data Science Manager",
    "Software Engineer",
    "Data Scientist",
  ],
  "AI & Machine Learning": [
    "VP of AI",
    "Head of AI",
    "Director of AI/ML",
    "Head of Machine Learning",
    "Principal ML Engineer",
    "ML Engineer",
    "AI Research Scientist",
    "Director of Computational Biology",
    "Head of Computational Biology",
  ],
  "Marketing": [
    "Chief Marketing Officer",
    "VP Marketing",
    "Head of Marketing",
    "Marketing Director",
    "Marketing Manager",
    "Growth Marketing Manager",
    "Marketing Specialist",
  ],
};

// --- Helpers ---

function inferRoleSeniority(role: string): string {
  const lower = role.toLowerCase();
  if (lower.includes('chief') || lower.includes('president') || lower.includes('founder')) return 'C-Level';
  if (lower.includes('vp') || lower.includes('svp')) return 'VP / SVP';
  if (lower.includes('director')) return 'Director';
  if (lower.includes('head of') || lower.includes('head ')) return 'Head of / Senior Manager';
  if (lower.includes('manager')) return 'Manager';
  return 'Individual Contributor';
}

function roleMatchesSelectedSeniority(role: string, selectedSeniority: string[]): boolean {
  if (selectedSeniority.length === 0) return true;
  return selectedSeniority.includes(inferRoleSeniority(role));
}

// --- Types ---

export interface CompanyProfile {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  company_sizes: string[];
  funding_stages: string[];
}

export interface SellerProfile {
  company_name: string;
  description: string | string[];
  customers_we_serve: string | string[];
  good_fit: string | string[];
  bad_fit: string | string[];
}

interface Signal {
  id: string;
  name: string;
  category: string;
}

export interface PersonaFormData {
  name: string;
  functions: string[];
  seniorityLevels: string[];
  jobTitles: string[];
  signals: string[];
}

export interface PersonaSaveData extends PersonaFormData {
  icpId: string | null;
}

interface PersonaFormProps {
  mode: 'create' | 'edit';
  initialData?: PersonaFormData;
  initialCompanyId?: string | null;
  companyProfiles: CompanyProfile[];
  sellerProfile?: SellerProfile | null;
  companyContactsMap?: Record<string, string>;
  onSave: (data: PersonaSaveData) => Promise<void>;
  onCancel: () => void;
  onEditExisting?: (contactId: string) => void;
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

// --- Main Component ---

export default function PersonaForm({
  mode,
  initialData,
  initialCompanyId,
  companyProfiles,
  sellerProfile,
  companyContactsMap,
  onSave,
  onCancel,
  onEditExisting,
}: PersonaFormProps) {
  const steps = mode === 'create' ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6];
  const stepLabels = mode === 'create'
    ? ['Company', 'Teams', 'Seniority', 'Roles', 'Name', 'Signals']
    : ['Teams', 'Seniority', 'Roles', 'Name', 'Signals'];
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];

  const [currentSection, setCurrentSection] = useState(firstStep);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(initialCompanyId ?? null);
  const [formData, setFormData] = useState<PersonaFormData>(initialData ?? {
    name: '',
    functions: [],
    seniorityLevels: [],
    jobTitles: [],
    signals: [],
  });
  const [customFunction, setCustomFunction] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingFunctions, setIsGeneratingFunctions] = useState(false);
  const [isGeneratingSeniority, setIsGeneratingSeniority] = useState(false);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  const [showAlreadyAddedModal, setShowAlreadyAddedModal] = useState(false);
  const [modalCompanyId, setModalCompanyId] = useState<string | null>(null);
  const [isLoadingSignals, setIsLoadingSignals] = useState(false);
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [showAllSignals, setShowAllSignals] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const selectedCompany = companyProfiles.find(c => c.id === selectedCompanyId);

  const combinedRoleOptions = Array.from(
    new Set(
      formData.functions.flatMap((area) =>
        (SPECIFIC_ROLE_OPTIONS[area] || []).filter((role) =>
          roleMatchesSelectedSeniority(role, formData.seniorityLevels)
        )
      )
    )
  );
  const additionalRoleOptions = formData.jobTitles.filter((role) => !combinedRoleOptions.includes(role));

  // --- AI Suggestion Functions (used in create mode) ---

  const generateSuggestedFunctions = async (company: CompanyProfile) => {
    setIsGeneratingFunctions(true);
    try {
      const response = await fetch('/api/suggest-functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerProfile,
          targetCompanyProfile: company,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.functions && Array.isArray(data.functions)) {
          const validFunctions = data.functions.filter((f: string) => FUNCTION_OPTIONS.includes(f));
          setFormData(prev => ({ ...prev, functions: validFunctions.slice(0, 5) }));
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
          sellerProfile,
          targetCompanyProfile: selectedCompany,
          selectedFunctions: formData.functions,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.seniority && Array.isArray(data.seniority)) {
          const validSeniority = data.seniority.filter((s: string) => SENIORITY_OPTIONS.includes(s));
          setFormData(prev => ({ ...prev, seniorityLevels: validSeniority }));
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
          setFormData(prev => ({ ...prev, name: data.name }));
        }
      }
    } catch (error) {
      console.error('Error generating name:', error);
    } finally {
      setIsGeneratingName(false);
    }
  };

  const preselectRolesForAllAreas = () => {
    if (formData.functions.length === 0 || formData.seniorityLevels.length === 0) return;

    const allAvailableTitles = formData.functions.flatMap((area) =>
      (SPECIFIC_ROLE_OPTIONS[area] || []).filter((role) =>
        roleMatchesSelectedSeniority(role, formData.seniorityLevels)
      )
    );

    setFormData(prev => ({
      ...prev,
      jobTitles: [...new Set([...prev.jobTitles, ...allAvailableTitles])],
    }));
  };

  // --- Company Selection (create mode) ---

  const handleSelectCompany = async (companyId: string) => {
    if (companyContactsMap?.[companyId]) {
      setModalCompanyId(companyId);
      setShowAlreadyAddedModal(true);
      return;
    }

    setSelectedCompanyId(companyId);
    const company = companyProfiles.find(c => c.id === companyId);
    if (company) {
      setCurrentSection(2);
      await generateSuggestedFunctions(company);
    }
  };

  const handleEditExistingContact = () => {
    if (modalCompanyId) {
      const contactId = companyContactsMap?.[modalCompanyId];
      if (contactId && onEditExisting) {
        onEditExisting(contactId);
      }
    }
    setShowAlreadyAddedModal(false);
    setModalCompanyId(null);
  };

  // --- Form Handlers ---

  const handleFunctionToggle = (func: string) => {
    setFormData(prev => {
      const current = prev.functions;
      const newFunctions = current.includes(func)
        ? current.filter(f => f !== func)
        : [...current, func];

      const validRolesForNewFunctions = new Set(
        newFunctions.flatMap(area =>
          (SPECIFIC_ROLE_OPTIONS[area] || []).filter(role =>
            roleMatchesSelectedSeniority(role, prev.seniorityLevels)
          )
        )
      );
      const stillValidRoles = prev.jobTitles.filter(role => validRolesForNewFunctions.has(role));

      return { ...prev, functions: newFunctions, jobTitles: stillValidRoles };
    });
  };

  const handleAddCustomFunction = () => {
    const func = customFunction.trim();
    if (!func) return;
    if (formData.functions.includes(func)) {
      toast.error('Business area already added');
      return;
    }
    setFormData(prev => ({ ...prev, functions: [...prev.functions, func] }));
    setCustomFunction('');
  };

  const handleSeniorityToggle = (level: string) => {
    setFormData(prev => {
      const current = prev.seniorityLevels;
      const newSeniority = current.includes(level)
        ? current.filter(l => l !== level)
        : [...current, level];

      const stillValidRoles = prev.jobTitles.filter(role =>
        roleMatchesSelectedSeniority(role, newSeniority)
      );

      return { ...prev, seniorityLevels: newSeniority, jobTitles: stillValidRoles };
    });
  };

  const handleRoleToggle = (role: string) => {
    setFormData(prev => {
      const current = prev.jobTitles;
      if (current.includes(role)) {
        return { ...prev, jobTitles: current.filter(r => r !== role) };
      }
      return { ...prev, jobTitles: [...current, role] };
    });
  };

  const handleAddCustomRole = () => {
    const role = customRole.trim();
    if (!role) return;
    if (formData.jobTitles.includes(role)) {
      toast.error('Specific role already added');
      return;
    }
    setFormData(prev => ({ ...prev, jobTitles: [...prev.jobTitles, role] }));
    setCustomRole('');
  };

  // --- Signal handlers ---

  const loadSignals = async () => {
    if (allSignals.length > 0) return;

    setIsLoadingSignals(true);
    try {
      if (formData.signals.length > 0) {
        const response = await fetch('/api/recommend-signals');
        if (response.ok) {
          const result = await response.json();
          setAllSignals(result.all || []);
        }
      } else {
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

  const handleSignalToggle = (signalId: string) => {
    setFormData(prev => ({
      ...prev,
      signals: prev.signals.includes(signalId)
        ? prev.signals.filter(id => id !== signalId)
        : [...prev.signals, signalId]
    }));
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

  // --- Navigation ---

  const handleNext = async () => {
    if (mode === 'create') {
      if (currentSection === 2) {
        setCurrentSection(3);
        await generateSuggestedSeniority();
      } else if (currentSection === 3) {
        setCurrentSection(4);
        preselectRolesForAllAreas();
      } else if (currentSection === 4) {
        setCurrentSection(5);
        await generateProfileName();
      } else if (currentSection === 5) {
        setCurrentSection(6);
        await loadSignals();
      } else {
        setCurrentSection(currentSection + 1);
      }
    } else {
      if (currentSection === 5) {
        setCurrentSection(6);
        await loadSignals();
      } else {
        setCurrentSection(currentSection + 1);
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'create' && !selectedCompanyId) {
      toast.error('Please select a company profile');
      setCurrentSection(1);
      return;
    }

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

    if (formData.jobTitles.length === 0) {
      toast.error('Please select at least one specific role');
      setCurrentSection(4);
      return;
    }

    if (!formData.name.trim()) {
      toast.error('Please enter a name for this buyer persona');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({ ...formData, icpId: selectedCompanyId });
    } catch (error) {
      console.error('Error saving persona:', error);
      toast.error('Failed to save persona. Please try again.');
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
      case 4: return formData.jobTitles.length > 0 ? 'complete' : 'incomplete';
      case 5: return formData.name ? 'complete' : 'incomplete';
      case 6: return formData.signals.length > 0 ? 'complete' : 'incomplete';
      default: return 'incomplete';
    }
  };

  // --- Render ---

  return (
    <div className="max-w-3xl mx-auto">
      {/* Company name banner (edit mode) */}
      {mode === 'edit' && selectedCompany && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Editing persona for</p>
            <p className="font-medium text-gray-900">{selectedCompany.name}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center">
              <button
                type="button"
                onClick={() => {
                  if (mode === 'create' && step > 1 && !selectedCompanyId) return;
                  setCurrentSection(step);
                }}
                disabled={mode === 'create' && step > 1 && !selectedCompanyId}
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
              {index < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${
                  getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          {stepLabels.map((label, index) => (
            <span key={label} className={currentSection === steps[index] ? 'text-arcova-teal font-medium' : ''}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSave}>
          {/* Section 1: Select Company Profile (create only) */}
          {mode === 'create' && currentSection === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Define a buyer persona</h2>
                <p className="text-sm text-gray-500 mb-4">Select a target company, then tell us who you typically sell to there.</p>
              </div>

              {companyProfiles.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No company profiles yet</h3>
                  <p className="text-gray-500 mb-4">Create a company profile first to define personas for it.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {companyProfiles.map((company) => {
                    const hasContacts = !!companyContactsMap?.[company.id];
                    return (
                      <button
                        key={company.id}
                        type="button"
                        onClick={() => handleSelectCompany(company.id)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors relative ${
                          selectedCompanyId === company.id
                            ? 'border-arcova-teal bg-arcova-teal/5'
                            : 'border-gray-200 hover:border-arcova-teal/50'
                        }`}
                      >
                        {hasContacts && (
                          <span className="absolute top-3 right-3 px-2 py-0.5 bg-arcova-teal text-white text-xs font-medium rounded-full flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                            </svg>
                            Contacts added
                          </span>
                        )}
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
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Section 2: Business areas */}
          {currentSection === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Which teams do you sell into at {selectedCompany?.name || 'this company'}?</h2>
                <p className="text-sm text-gray-500 mb-4">Select all relevant the teams where your ideal contacts sit. You may sell into different teams depending on the product or deal size. We've suggested some based on your profile.</p>
              </div>

              {isGeneratingFunctions ? (
                <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-arcova-teal"></div>
                  <span>Selecting relevant teams...</span>
                </div>
              ) : (
                <>
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

                  <button
                    type="button"
                    onClick={() => setShowAllFunctions(!showAllFunctions)}
                    className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                  >
                    {showAllFunctions ? 'Hide all teams' : 'See all teams'}
                    <svg
                      className={`w-4 h-4 transition-transform ${showAllFunctions ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showAllFunctions && (
                    <div className="space-y-4 pt-2 border-t border-gray-200">
                      <div className="flex flex-wrap gap-2">
                        {FUNCTION_OPTIONS.filter((func) => !formData.functions.includes(func)).map((func) => (
                          <button
                            key={func}
                            type="button"
                            onClick={() => handleFunctionToggle(func)}
                            className="px-4 py-2 rounded-full text-sm transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
                          >
                            {func}
                          </button>
                        ))}
                      </div>

                      <div className="pt-3 border-t border-gray-200">
                        <label className="text-sm text-gray-600 mb-2 block">Other teams not listed?</label>
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
                            placeholder="Enter custom team"
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
                </>
              )}

              <p className="text-xs text-gray-500 mt-2">{formData.functions.length} selected</p>
            </div>
          )}

          {/* Section 3: Seniority */}
          {currentSection === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">How senior are your typical buyers at {selectedCompany?.name || 'this company'}?</h2>
                <p className="text-sm text-gray-500 mb-4">Select all that apply. You may sell to different levels depending on the product or deal size.</p>
              </div>

              {isGeneratingSeniority ? (
                <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-arcova-teal"></div>
                  <span>Selecting relevant seniority levels...</span>
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

          {/* Section 4: Specific roles */}
          {currentSection === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Which roles are you typically trying to reach at {selectedCompany?.name || 'this company'}?</h2>
                <p className="text-sm text-gray-500 mb-4">Select all that apply. We've suggested the most relevant ones based on your teams and seniority selections. Remove any that don't fit or add your own.</p>
              </div>

              <>
                {formData.functions.map((area) => {
                  const areaRoles = (SPECIFIC_ROLE_OPTIONS[area] || []).filter((role) =>
                    roleMatchesSelectedSeniority(role, formData.seniorityLevels)
                  );
                  if (areaRoles.length === 0) return null;

                  return (
                    <div key={area} className="pt-2 border-t border-gray-200">
                      <h3 className="text-sm font-medium text-gray-900 mb-2">{area}</h3>
                      <div className="flex flex-wrap gap-2">
                        {areaRoles.map((role) => {
                          const isSelected = formData.jobTitles.includes(role);
                          return (
                            <button
                              key={`${area}-${role}`}
                              type="button"
                              onClick={() => handleRoleToggle(role)}
                              className={`px-4 py-2 rounded-full text-sm transition-colors ${
                                isSelected
                                  ? 'bg-arcova-teal text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              {role}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {additionalRoleOptions.length > 0 && (
                  <div className="pt-2 border-t border-gray-200">
                    <h3 className="text-sm font-medium text-gray-900 mb-2">Additional Roles</h3>
                    <div className="flex flex-wrap gap-2">
                      {additionalRoleOptions.map((role) => (
                        <button
                          key={`additional-${role}`}
                          type="button"
                          onClick={() => handleRoleToggle(role)}
                          className="px-3 py-1.5 rounded-full text-sm bg-arcova-teal text-white hover:bg-arcova-teal/90 transition-colors"
                        >
                          {role} ×
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {combinedRoleOptions.length === 0 && (
                  <p className="text-sm text-gray-500">
                    No predefined role suggestions are available for the selected business areas yet. You can add a custom role below.
                  </p>
                )}

                <div className="pt-3 border-t border-gray-200">
                  <label className="text-sm text-gray-600 mb-2 block">Add a specific role</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customRole}
                      onChange={(e) => setCustomRole(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomRole();
                        }
                      }}
                      placeholder="e.g., Director of Clinical Operations"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomRole}
                      disabled={!customRole.trim()}
                      className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors disabled:opacity-50 text-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </>
            </div>
          )}

          {/* Section 5: Name */}
          {currentSection === 5 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Name this buyer segment</h2>
                <p className="text-sm text-gray-500 mb-4">Give this group a name so you can identify it easily. Click to generate one based on your selections.</p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., VP at Oncology Biotech"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={generateProfileName}
                  disabled={isGeneratingName}
                  className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 disabled:opacity-50"
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

              {/* Summary */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-900 mb-3">Profile Summary</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500">Company Profile:</span>
                    <span className="ml-2 text-gray-900">{selectedCompany?.name || 'None selected'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Business Areas:</span>
                    <span className="ml-2 text-gray-900">{formData.functions.join(', ') || 'None selected'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Seniority:</span>
                    <span className="ml-2 text-gray-900">{formData.seniorityLevels.join(', ') || 'None selected'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Roles:</span>
                    <span className="ml-2 text-gray-900">{formData.jobTitles.join(', ') || 'None selected'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 6: Signals */}
          {currentSection === 6 && (
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

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (currentSection > firstStep) {
                  setCurrentSection(currentSection - 1);
                } else if (mode === 'edit') {
                  onCancel();
                }
              }}
              className={`px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors ${
                mode === 'create' && currentSection === 1 ? 'invisible' : ''
              }`}
            >
              {mode === 'edit' && currentSection === firstStep ? 'Cancel' : 'Back'}
            </button>

            {currentSection < lastStep ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  handleNext();
                }}
                disabled={
                  (currentSection === 1 && !selectedCompanyId) ||
                  (currentSection === 2 && formData.functions.length === 0) ||
                  (currentSection === 3 && formData.seniorityLevels.length === 0) ||
                  (currentSection === 4 && formData.jobTitles.length === 0) ||
                  (currentSection === 5 && !formData.name.trim()) ||
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
                    {mode === 'create' ? 'Saving...' : 'Updating...'}
                  </>
                ) : (
                  mode === 'create' ? 'Save' : 'Update'
                )}
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Already Added Modal (create mode) */}
      {showAlreadyAddedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md mx-4 text-center">
            <div className="w-16 h-16 bg-arcova-teal/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-arcova-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Persona already added</h2>
            <p className="text-gray-600 mb-6">
              You've already set up a persona for this company. Click edit to view or update it.
            </p>
            <div className="flex flex-col gap-3 items-center">
              <button
                onClick={handleEditExistingContact}
                className="w-full sm:w-auto px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  setShowAlreadyAddedModal(false);
                  setModalCompanyId(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
