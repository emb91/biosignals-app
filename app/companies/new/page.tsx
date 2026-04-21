'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Toaster } from 'sonner';
import CompanyForm, { type CompanyFormData } from '@/components/CompanyForm';

export default function ICPNewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;

      try {
        const response = await fetch('/api/user-company-profile');
        if (response.ok) {
          const result = await response.json();
          const profile = result.data;
          setHasProfile(Boolean(profile && typeof profile.company_name === 'string' && profile.company_name.trim()));
        }
      } finally {
        setLoadingProfile(false);
      }
    };

    if (user) fetchProfile();
  }, [user]);

  const handleSave = async (formData: CompanyFormData) => {
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        exampleCompanies: formData.exampleCompanies.map(c => JSON.stringify(c)),
      }),
    });

    if (!response.ok) throw new Error('Failed to save ICP');
    setShowSuccessModal(true);
  };

  if (loading || loadingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4">
          {hasProfile ? (
            <CompanyForm
              key={formKey}
              mode="create"
              onSave={handleSave}
              onCancel={() => router.push('/companies')}
            />
          ) : null}
        </div>
      </div>
      <Toaster position="top-center" richColors />

      {!hasProfile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 max-w-md mx-4 text-center">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Complete your profile first</h2>
            <p className="text-gray-600 mb-6">
              You cannot add a company until you fill out My Profile.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => router.push('/dashboard')}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Back to dashboard
              </button>
              <button
                onClick={() => router.push('/my-profile')}
                className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
              >
                Go to My Profile
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
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">Your ICP is ready</h2>
            <p className="text-gray-600 mb-6">
              We'll use this to surface the most relevant accounts and teams for you.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => router.push('/companies')}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                View your companies
              </button>
              <button
                onClick={() => router.push('/contacts/new')}
                className="px-4 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors flex items-center justify-center gap-1"
              >
                Add a team
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
