'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast, Toaster } from 'sonner';
import PersonaForm, {
  type PersonaSaveData,
  type CompanyProfile,
  type SellerProfile,
} from '@/components/PersonaForm';

interface ContactProfile {
  id: string;
  icp_id: string | null;
}

export default function ContactNewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [companyContactsMap, setCompanyContactsMap] = useState<Record<string, string>>({});
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [companiesRes, sellerRes, contactsRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/user-company-profile'),
          fetch('/api/contacts'),
        ]);

        if (companiesRes.ok) {
          const data = await companiesRes.json();
          setCompanyProfiles(data.data || []);
        }

        if (sellerRes.ok) {
          const data = await sellerRes.json();
          setSellerProfile(data.data || null);
        }

        if (contactsRes.ok) {
          const contactsData = await contactsRes.json();
          const contacts: ContactProfile[] = contactsData.data || [];
          const map: Record<string, string> = {};
          contacts.forEach((contact) => {
            if (contact.icp_id && !map[contact.icp_id]) {
              map[contact.icp_id] = contact.id;
            }
          });
          setCompanyContactsMap(map);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load data');
      } finally {
        setLoadingData(false);
      }
    };

    if (user) fetchData();
  }, [user]);

  const handleSave = async (data: PersonaSaveData) => {
    const response = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 409 && result.existingContactId) {
        toast.error('A persona already exists for this company.');
        router.push(`/personas/${result.existingContactId}/edit`);
        return;
      }
      throw new Error(result.error || 'Failed to save persona');
    }

    if (data.icpId && result.data?.id) {
      setCompanyContactsMap(prev => ({
        ...prev,
        [data.icpId!]: result.data.id,
      }));
    }

    setShowSuccessModal(true);
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  const hasProfile = Boolean(sellerProfile && typeof sellerProfile.company_name === 'string' && sellerProfile.company_name.trim());
  const hasCompanies = companyProfiles.length > 0;
  const missingProfile = !hasProfile;
  const missingCompanies = !hasCompanies;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          {!missingProfile && !missingCompanies ? (
            <PersonaForm
              key={formKey}
              mode="create"
              companyProfiles={companyProfiles}
              sellerProfile={sellerProfile}
              companyContactsMap={companyContactsMap}
              onSave={handleSave}
              onCancel={() => router.push('/personas')}
              onEditExisting={(contactId) => router.push(`/personas/${contactId}/edit`)}
            />
          ) : null}
        </div>
      </div>

      <Toaster position="top-center" richColors />

      {(missingProfile || missingCompanies) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-lg mx-4 text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Complete setup before adding personas</h2>
            <p className="text-gray-600 mb-6">
              {missingProfile && missingCompanies
                ? 'You cannot add a persona until you fill out My Profile and add at least one company.'
                : missingProfile
                ? 'You cannot add a persona until you fill out My Profile.'
                : 'You cannot add a persona until you add at least one company profile.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Back to dashboard
              </button>
              <button
                onClick={() => router.push(missingProfile ? '/my-profile' : '/companies/new')}
                className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
              >
                {missingProfile ? 'Go to My Profile' : 'Add a company'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md mx-4 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Buyer persona saved</h2>
            <p className="text-gray-600 mb-6">
              We'll use this to find the right people at your target companies.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => router.push('/personas')}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                View all personas
              </button>
              <button
                onClick={() => router.push('/results')}
                className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors flex items-center justify-center gap-1"
              >
                Get leads
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
