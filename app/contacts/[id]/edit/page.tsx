'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
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

export default function ContactEditPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const contactId = params.id as string;

  const [currentSection, setCurrentSection] = useState(2);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    functions: [] as string[],
    seniorityLevels: [] as string[],
    jobTitles: [] as string[],
  });
  const [customFunction, setCustomFunction] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [showAllFunctions, setShowAllFunctions] = useState(false);

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
              jobTitles: contact.job_titles || [],
            });
            setSelectedCompanyId(contact.icp_id || null);
          }
        } else {
          toast.error('Contact not found');
          router.push('/personas');
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
    setFormData(prev => ({
      ...prev,
      functions: [...prev.functions, func],
    }));
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
      toast.error('Role already added');
      return;
    }
    setFormData(prev => ({
      ...prev,
      jobTitles: [...prev.jobTitles, role],
    }));
    setCustomRole('');
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
      toast.error('Failed to generate name');
    } finally {
      setIsGeneratingName(false);
    }
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

    if (formData.jobTitles.length === 0) {
      toast.error('Please select at least one role');
      setCurrentSection(4);
      return;
    }

    if (!formData.name.trim()) {
      toast.error('Please enter a name for this buyer persona');
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
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update buyer persona');
      }

      toast.success('Buyer persona updated');
      router.push('/personas');
    } catch (error) {
      console.error('Error updating contact:', error);
      toast.error('Failed to update buyer persona. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const getSectionStatus = (section: number): 'complete' | 'incomplete' | 'current' => {
    if (section === currentSection) return 'current';
    switch (section) {
      case 2: return formData.functions.length > 0 ? 'complete' : 'incomplete';
      case 3: return formData.seniorityLevels.length > 0 ? 'complete' : 'incomplete';
      case 4: return formData.jobTitles.length > 0 ? 'complete' : 'incomplete';
      case 5: return formData.name ? 'complete' : 'incomplete';
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
        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            {/* Linked Company Profile Display */}
            {selectedCompany && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Editing persona for</p>
                  <p className="font-medium text-gray-900">{selectedCompany.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push('/personas')}
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Exit
                </button>
              </div>
            )}

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between">
                {[2, 3, 4, 5].map((step, index) => (
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
                    {index < 3 && (
                      <div className={`flex-1 h-0.5 mx-1 ${
                        getSectionStatus(step) === 'complete' ? 'bg-arcova-teal/30' : 'bg-gray-200'
                      }`} />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span className={currentSection === 2 ? 'text-arcova-teal font-medium' : ''}>Teams</span>
                <span className={currentSection === 3 ? 'text-arcova-teal font-medium' : ''}>Seniority</span>
                <span className={currentSection === 4 ? 'text-arcova-teal font-medium' : ''}>Roles</span>
                <span className={currentSection === 5 ? 'text-arcova-teal font-medium' : ''}>Name</span>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <form onSubmit={handleSave}>
                {/* Section 2: Business Areas */}
                {currentSection === 2 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which teams should we target?</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        These are suggested based on your setup. Select all that matter.
                      </p>
                    </div>

                    {/* Selected teams */}
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

                    {/* See all teams toggle */}
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

                    {/* All teams (collapsible) */}
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

                        {/* Other - custom input */}
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

                {/* Section 4: Roles */}
                {currentSection === 4 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Which roles are you typically trying to reach?</h2>
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
                          <span className="text-gray-500">Functions:</span>
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

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentSection > 2) {
                        setCurrentSection(currentSection - 1);
                      } else {
                        router.push('/personas');
                      }
                    }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    {currentSection === 2 ? 'Cancel' : 'Back'}
                  </button>
                  
                  {currentSection < 5 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setCurrentSection(currentSection + 1);
                      }}
                      disabled={
                        (currentSection === 2 && formData.functions.length === 0) ||
                        (currentSection === 3 && formData.seniorityLevels.length === 0) ||
                        (currentSection === 4 && formData.jobTitles.length === 0)
                      }
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
