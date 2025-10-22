'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, getDocs, query, where, limit, serverTimestamp } from 'firebase/firestore';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';
import { toast, Toaster } from 'sonner';

// Register locale
countries.registerLocale(enLocale);

// Continent to country code mapping
const CONTINENT_MAP: Record<string, string[]> = {
  "Africa": ["DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CD", "CG", "CI", "DJ", "EG", "GQ", "ER", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "YT", "MA", "MZ", "NA", "NE", "NG", "RE", "RW", "SH", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "SZ", "TZ", "TG", "TN", "UG", "ZM", "ZW"],
  "Asia-Pacific (APAC)": ["AF", "AU", "BD", "BT", "BN", "KH", "CN", "CX", "CC", "CK", "FJ", "PF", "GU", "HK", "IN", "ID", "JP", "KZ", "KI", "KP", "KR", "KG", "LA", "MO", "MY", "MV", "MH", "FM", "MN", "MM", "NR", "NP", "NC", "NZ", "NU", "NF", "MP", "PK", "PW", "PG", "PH", "PN", "WS", "SG", "SB", "LK", "TW", "TJ", "TH", "TL", "TK", "TO", "TM", "TV", "UZ", "VU", "VN", "WF"],
  "Europe": ["AX", "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FO", "FI", "FR", "DE", "GI", "GR", "GG", "VA", "HU", "IS", "IE", "IM", "IT", "JE", "XK", "LV", "LI", "LT", "LU", "MK", "MT", "MD", "MC", "ME", "NL", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SJ", "SE", "CH", "UA", "GB"],
  "Middle East": ["BH", "IQ", "IR", "IL", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "AE", "YE"],
  "North America": ["AI", "AG", "AW", "BS", "BB", "BZ", "BM", "BQ", "VG", "CA", "KY", "CR", "CU", "CW", "DM", "DO", "SV", "GL", "GD", "GP", "GT", "HT", "HN", "JM", "MQ", "MX", "MS", "NI", "PA", "PM", "PR", "BL", "KN", "LC", "MF", "VC", "SX", "TT", "TC", "US", "VI"],
  "Latin America": ["AR", "BO", "BR", "CL", "CO", "EC", "FK", "GF", "GY", "PY", "PE", "SR", "UY", "VE"]
};

// Focus area options based on organization type
const FOCUS_AREA_OPTIONS: Record<string, string[]> = {
  "Biotechnology": [
    "Cell & Gene Therapy",
    "Immunology",
    "Oncology",
    "Genomics / Sequencing",
    "Drug Discovery",
    "Vaccines"
  ],
  "Pharmaceuticals": [
    "Drug Development",
    "Clinical Trials",
    "Regulatory Affairs",
    "Manufacturing / Formulation"
  ],
  "Diagnostics & IVD": [
    "Molecular Diagnostics",
    "Point-of-Care Testing",
    "Biomarker Development"
  ],
  "CRO": [
    "Clinical Research Services",
    "Preclinical Studies",
    "Regulatory Submissions"
  ],
  "CDMO": [
    "Process Development",
    "Manufacturing",
    "Quality Control"
  ],
  "Life Science Tools": [
    "Lab Automation",
    "Reagents / Consumables",
    "Analytical Instruments",
    "Bioinformatics Software"
  ]
};

export default function ICPPage() {
  const { user, firstName, loading, logout } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    organizationTypes: [] as string[],
    focusAreas: [] as string[],
    companySizes: [] as string[],
    regions: {
      continents: [] as string[],
      countries: [] as string[],
      hubs: [] as string[]
    },
    additionalCriteria: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [existingDocId, setExistingDocId] = useState<string | null>(null);
  const [hubInput, setHubInput] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  // Load existing ICP on mount
  useEffect(() => {
    const loadExistingICP = async () => {
      if (!user) return;

      try {
        const icpsRef = collection(db, 'icps');
        const q = query(
          icpsRef,
          where('user_id', '==', user.uid),
          limit(1)
        );

        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const doc = querySnapshot.docs[0];
          const data = doc.data();
          setExistingDocId(doc.id);
          setFormData({
            organizationTypes: data.organizationTypes || data.industries || [],
            focusAreas: data.focusAreas || [],
            companySizes: data.companySizes || [],
            regions: data.regions || {
              continents: [],
              countries: [],
              hubs: []
            },
            additionalCriteria: data.additionalCriteria || '',
          });
        }
      } catch (error) {
        console.error('Error loading ICP:', error);
      } finally {
        setLoadingExisting(false);
      }
    };

    loadExistingICP();
  }, [user]);

  const handleMultiSelect = (field: keyof typeof formData, value: string) => {
    if (Array.isArray(formData[field])) {
      const currentArray = formData[field] as string[];
      if (currentArray.includes(value)) {
        setFormData(prev => ({
          ...prev,
          [field]: currentArray.filter(item => item !== value)
        }));
      } else {
        // Check if already at max limit
        if (currentArray.length >= 3) {
          toast.error('Maximum 3 selections', {
            description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
          });
          return;
        }
        setFormData(prev => ({
          ...prev,
          [field]: [...currentArray, value]
        }));
      }
    }
  };

  const handleContinentToggle = (continent: string) => {
    const currentContinents = formData.regions.continents;
    let newContinents: string[];
    
    if (currentContinents.includes(continent)) {
      newContinents = currentContinents.filter(c => c !== continent);
      
      // Remove countries from deselected continent
      const removedCountries = CONTINENT_MAP[continent] || [];
      const newCountries = formData.regions.countries.filter(
        country => !removedCountries.includes(country)
      );
      
      setFormData(prev => ({
        ...prev,
        regions: {
          ...prev.regions,
          continents: newContinents,
          countries: newCountries
        }
      }));
    } else {
      // Check if already at max limit
      if (currentContinents.length >= 3) {
        toast.error('Maximum 3 selections', {
          description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
        });
        return;
      }
      newContinents = [...currentContinents, continent];
      setFormData(prev => ({
        ...prev,
        regions: {
          ...prev.regions,
          continents: newContinents
        }
      }));
    }
  };

  const handleCountryToggle = (countryCode: string) => {
    const currentCountries = formData.regions.countries;
    
    if (currentCountries.includes(countryCode)) {
      const newCountries = currentCountries.filter(c => c !== countryCode);
      setFormData(prev => ({
        ...prev,
        regions: {
          ...prev.regions,
          countries: newCountries
        }
      }));
    } else {
      // Check if already at max limit
      if (currentCountries.length >= 3) {
        toast.error('Maximum 3 selections', {
          description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
        });
        return;
      }
      const newCountries = [...currentCountries, countryCode];
      setFormData(prev => ({
        ...prev,
        regions: {
          ...prev.regions,
          countries: newCountries
        }
      }));
    }
  };

  const handleAddHub = () => {
    const trimmedHub = hubInput.trim();
    if (!trimmedHub) return;
    
    if (formData.regions.hubs.includes(trimmedHub)) {
      toast.error('Already added', {
        description: 'This location is already in your list.'
      });
      return;
    }
    
    // Check if already at max limit
    if (formData.regions.hubs.length >= 3) {
      toast.error('Maximum 3 selections', {
        description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
      });
      return;
    }
    
    setFormData(prev => ({
      ...prev,
      regions: {
        ...prev.regions,
        hubs: [...prev.regions.hubs, trimmedHub]
      }
    }));
    setHubInput('');
  };

  const handleRemoveHub = (hub: string) => {
    setFormData(prev => ({
      ...prev,
      regions: {
        ...prev.regions,
        hubs: prev.regions.hubs.filter(h => h !== hub)
      }
    }));
  };

  // Get available countries based on selected continents
  const getAvailableCountries = () => {
    if (formData.regions.continents.length === 0) return [];
    
    const countryCodes = formData.regions.continents
      .flatMap(continent => CONTINENT_MAP[continent] || []);
    
    return countryCodes
      .map(code => ({
        code,
        name: countries.getName(code, 'en') || code
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  // Get available focus areas based on selected organization types
  const getAvailableFocusAreas = () => {
    if (formData.organizationTypes.length === 0) return [];
    
    const focusAreas = formData.organizationTypes
      .flatMap(type => FOCUS_AREA_OPTIONS[type] || []);
    
    // Remove duplicates
    return [...new Set(focusAreas)];
  };

  const handleOrganizationTypeChange = (value: string) => {
    const currentTypes = formData.organizationTypes;
    let newTypes: string[];
    
    if (currentTypes.includes(value)) {
      newTypes = currentTypes.filter(type => type !== value);
      
      // Remove focus areas that are no longer available
      const removedFocusAreas = FOCUS_AREA_OPTIONS[value] || [];
      const newFocusAreas = formData.focusAreas.filter(
        area => {
          // Keep if it exists in any remaining organization type
          return newTypes.some(type => 
            (FOCUS_AREA_OPTIONS[type] || []).includes(area)
          );
        }
      );
      
      setFormData(prev => ({
        ...prev,
        organizationTypes: newTypes,
        focusAreas: newFocusAreas
      }));
    } else {
      // Check if already at max limit
      if (currentTypes.length >= 3) {
        toast.error('Maximum 3 selections', {
          description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
        });
        return;
      }
      newTypes = [...currentTypes, value];
      setFormData(prev => ({
        ...prev,
        organizationTypes: newTypes
      }));
    }
  };

  const handleFocusAreaToggle = (value: string) => {
    const currentAreas = formData.focusAreas;
    
    if (currentAreas.includes(value)) {
      const newAreas = currentAreas.filter(area => area !== value);
      setFormData(prev => ({
        ...prev,
        focusAreas: newAreas
      }));
    } else {
      // Check if already at max limit
      if (currentAreas.length >= 3) {
        toast.error('Maximum 3 selections', {
          description: 'You get better results by keeping distinct company profiles for targeting. If you want to add more, please create another company profile.'
        });
        return;
      }
      const newAreas = [...currentAreas, value];
      setFormData(prev => ({
        ...prev,
        focusAreas: newAreas
      }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const icpData = {
        user_id: user.uid,
        user_email: user.email,
        ...formData,
        updated_at: serverTimestamp(),
      };

      const icpsRef = collection(db, 'icps');

      if (existingDocId) {
        // Update existing ICP
        const q = query(icpsRef, where('user_id', '==', user.uid), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          const docRef = querySnapshot.docs[0].ref;
          await updateDoc(docRef, icpData);
        }
      } else {
        // Create new ICP
        const docRef = await addDoc(icpsRef, {
          ...icpData,
          created_at: serverTimestamp(),
        });
        setExistingDocId(docRef.id);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving ICP:', error);
      alert('Failed to save ICP. Please try again.');
    } finally {
      setIsSaving(false);
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
            {/* Progress Indicator */}
            <div className="mb-8">
              <div className="flex items-center justify-center space-x-4 md:space-x-8">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-arcova-teal rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-semibold">1</span>
                  </div>
                  <span className="ml-2 text-arcova-teal font-semibold text-sm md:text-base">ICP</span>
                </div>
                <div className="w-8 md:w-16 h-0.5 bg-gray-300"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-semibold">2</span>
                  </div>
                  <span className="ml-2 text-gray-500 text-sm md:text-base">Personas</span>
                </div>
                <div className="w-8 md:w-16 h-0.5 bg-gray-300"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-semibold">3</span>
                  </div>
                  <span className="ml-2 text-gray-500 text-sm md:text-base">Signals</span>
                </div>
                <div className="w-8 md:w-16 h-0.5 bg-gray-300"></div>
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 text-sm font-semibold">4</span>
                  </div>
                  <span className="ml-2 text-gray-500 text-sm md:text-base">Leads</span>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  Define Your Ideal Company Profile
                </h2>
                <div className="space-y-3 text-gray-600">
                  <p>
                    The purpose of this step is to narrow in on a specific company type or market segment to target.
                  </p>
                  <p>
                    Start with one clear profile, you can always create additional profiles later for other audiences or products.
                  </p>
                  <p>
                    An example of your ideal company profile might look like: <span className="font-semibold">"Biotechnology companies focusing on Cell & Gene Therapy with &lt;100 employees in Europe (Basel, Munich)."</span>
                  </p>
                  <p>
                    Your AI agent will use this profile to focus searches, monitor relevant market signals, and refine outreach so every interaction is more targeted and timely.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSave} className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column */}
                  <div className="space-y-6">
                    {/* Organization Type */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Organization Type
                      </label>
                      <p className="text-sm text-gray-500 mb-3">Which types of organizations do you want to focus on?</p>
                      <div className="relative">
                        <select 
                          onChange={(e) => {
                            if (e.target.value) {
                              handleOrganizationTypeChange(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none"
                        >
                          <option value="">Select organization type…</option>
                          {Object.keys(FOCUS_AREA_OPTIONS).map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.organizationTypes.map((type) => (
                          <span key={type} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {type}
                            <button
                              type="button"
                              onClick={() => handleOrganizationTypeChange(type)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Focus Area */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Focus Area
                      </label>
                      <p className="text-sm text-gray-500 mb-3">What areas or technologies do they focus on?</p>
                      <div className="relative">
                        <select 
                          onChange={(e) => {
                            if (e.target.value) {
                              handleFocusAreaToggle(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none"
                          disabled={formData.organizationTypes.length === 0}
                        >
                          <option value="">
                            {formData.organizationTypes.length === 0 
                              ? 'Select organization type first…' 
                              : 'Select focus area…'}
                          </option>
                          {getAvailableFocusAreas().map((area) => (
                            <option key={area} value={area}>{area}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.focusAreas.map((area) => (
                          <span key={area} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {area}
                            <button
                              type="button"
                              onClick={() => handleFocusAreaToggle(area)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Company Size */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Size
                      </label>
                      <p className="text-sm text-gray-500 mb-3">What size of organization are you interested in?</p>
                      <div className="relative">
                        <select 
                          onChange={(e) => {
                            if (e.target.value) {
                              handleMultiSelect('companySizes', e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none"
                        >
                          <option value="">Select employee range…</option>
                          {['1-10 employees', '11-50 employees', '51-200 employees', '201-1000 employees', '1000+ employees'].map((size) => (
                            <option key={size} value={size}>{size}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.companySizes.map((size, index) => (
                          <span key={index} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {size}
                            <button
                              type="button"
                              onClick={() => handleMultiSelect('companySizes', size)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-6">
                    {/* Regions */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Regions
                      </label>
                      <p className="text-sm text-gray-500 mb-3">Which global regions are you focused on?</p>
                      <div className="relative">
                        <select 
                          onChange={(e) => {
                            if (e.target.value) {
                              handleContinentToggle(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none"
                        >
                          <option value="">Select regions…</option>
                          {Object.keys(CONTINENT_MAP).map((continent) => (
                            <option key={continent} value={continent}>{continent}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.regions.continents.map((continent) => (
                          <span key={continent} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {continent}
                            <button
                              type="button"
                              onClick={() => handleContinentToggle(continent)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Countries */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Countries
                      </label>
                      <p className="text-sm text-gray-500 mb-3">Any specific countries you want to focus on?</p>
                      <div className="relative">
                        <select 
                          onChange={(e) => {
                            if (e.target.value) {
                              handleCountryToggle(e.target.value);
                              e.target.value = '';
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent appearance-none"
                          disabled={formData.regions.continents.length === 0}
                        >
                          <option value="">
                            {formData.regions.continents.length === 0 
                              ? 'Select regions first…' 
                              : 'Select countries…'}
                          </option>
                          {getAvailableCountries().map(({ code, name }) => (
                            <option key={code} value={code}>{name}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.regions.countries.map((countryCode) => (
                          <span key={countryCode} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {countries.getName(countryCode, 'en')}
                            <button
                              type="button"
                              onClick={() => handleCountryToggle(countryCode)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Target States / Cities */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Target States / Cities
                      </label>
                      <p className="text-sm text-gray-500 mb-3">Are there particular states or cities that matter to you?</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={hubInput}
                          onChange={(e) => setHubInput(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddHub();
                            }
                          }}
                          placeholder="e.g., Basel, Munich, Boston"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                        />
                        <button
                          type="button"
                          onClick={handleAddHub}
                          className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 min-h-[32px]">
                        {formData.regions.hubs.map((hub) => (
                          <span key={hub} className="inline-flex items-center gap-1 px-3 py-1 bg-arcova-teal/10 text-arcova-teal rounded-full text-sm">
                            {hub}
                            <button
                              type="button"
                              onClick={() => handleRemoveHub(hub)}
                              className="hover:text-arcova-teal/70"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Criteria */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center">
                      Additional Criteria (Optional)
                      <svg className="w-4 h-4 text-gray-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  </label>
                  <textarea
                    value={formData.additionalCriteria}
                    onChange={(e) => setFormData(prev => ({ ...prev, additionalCriteria: e.target.value }))}
                    rows={4}
                    placeholder="Any additional criteria or specific requirements for your ideal customer profile..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent resize-none"
                  />
                </div>

                {/* Form Actions */}
                <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                  <div>
                    {saveSuccess && (
                      <span className="text-green-600 text-sm flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                        </svg>
                        ICP saved successfully
                      </span>
                    )}
                  </div>
                  <div className="flex space-x-4">
                    <button
                      type="button"
                      onClick={() => router.push('/dashboard')}
                      className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Saving...
                        </>
                      ) : (
                        'Save & Continue'
                      )}
                    </button>
                  </div>
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
