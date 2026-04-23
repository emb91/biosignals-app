'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast, Toaster } from 'sonner';
import CompanyForm, { type CompanyFormData, type ExampleCompany } from '@/components/CompanyForm';

export default function ICPEditPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const icpId = params.id as string;

  const [initialData, setInitialData] = useState<CompanyFormData | null>(null);
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
        const response = await fetch(`/api/company-criteria/${icpId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            const data = result.data;

            const storedCompanies = data.example_companies || [];
            const exampleCompanies: ExampleCompany[] = storedCompanies.map((item: string) => {
              try {
                return JSON.parse(item);
              } catch {
                return { url: '', companyName: item };
              }
            });

            const storedSignals = data.signals || [];
            const loadedSignals = storedSignals.map((item: string) => {
              try {
                const parsed = JSON.parse(item);
                return parsed.id || item;
              } catch {
                return item;
              }
            });

            setInitialData({
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
          }
        } else {
          toast.error('ICP not found');
          router.push('/company-criteria');
        }
      } catch (error) {
        console.error('Error loading ICP:', error);
        toast.error('Failed to load ICP');
        router.push('/company-criteria');
      } finally {
        setLoadingIcp(false);
      }
    };

    if (user) {
      loadICP();
    }
  }, [user, icpId, router]);

  const handleSave = async (formData: CompanyFormData) => {
    const response = await fetch(`/api/company-criteria/${icpId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        exampleCompanies: formData.exampleCompanies.map(c => JSON.stringify(c)),
      }),
    });

    if (!response.ok) throw new Error('Failed to save ICP');

    toast.success('ICP updated successfully');
    router.push('/company-criteria');
  };

  if (loading || loadingIcp) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user || !initialData) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4">
          <CompanyForm
            mode="edit"
            initialData={initialData}
            onSave={handleSave}
            onCancel={() => router.push('/company-criteria')}
          />
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}
