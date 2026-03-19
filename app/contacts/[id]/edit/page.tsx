'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast, Toaster } from 'sonner';
import PersonaForm, {
  type PersonaSaveData,
  type CompanyProfile,
  type PersonaFormData,
} from '@/components/PersonaForm';

export default function ContactEditPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const contactId = params.id as string;

  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [initialData, setInitialData] = useState<PersonaFormData | null>(null);
  const [initialCompanyId, setInitialCompanyId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

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
            const functionNames = contact.functions?.map((f: string) => {
              try {
                const parsed = JSON.parse(f);
                return parsed.name || f;
              } catch {
                return f;
              }
            }) || [];

            setInitialData({
              name: contact.name || '',
              functions: functionNames,
              seniorityLevels: contact.seniority_levels || [],
              jobTitles: contact.job_titles || [],
              signals: contact.signals || [],
            });
            setInitialCompanyId(contact.icp_id || null);
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

    if (user && contactId) fetchData();
  }, [user, contactId, router]);

  const handleSave = async (data: PersonaSaveData) => {
    const response = await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error('Failed to update buyer persona');

    toast.success('Buyer persona updated');
    router.push('/personas');
  };

  if (loading || loadingData) {
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

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <PersonaForm
            mode="edit"
            initialData={initialData}
            initialCompanyId={initialCompanyId}
            companyProfiles={companyProfiles}
            onSave={handleSave}
            onCancel={() => router.push('/personas')}
          />
        </div>
      </div>

      <Toaster position="top-center" richColors />
    </div>
  );
}
