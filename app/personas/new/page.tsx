'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import SetupFlow from '@/components/SetupFlow';

type CompanyProfile = {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas?: string[];
  modalities?: string[];
  development_stages?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
  example_company_enrichment?: {
    company_name?: string | null;
  } | null;
};

type PersonaRecord = {
  id: string;
  icp_id: string | null;
};

export default function PersonaNewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredIcpId = searchParams.get('icpId');
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [companyContactsMap, setCompanyContactsMap] = useState<Record<string, string>>({});
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const [companyRes, personaRes] = await Promise.all([
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
        ]);

        if (companyRes.ok) {
          const result = await companyRes.json();
          setCompanyProfiles(result.data || []);
        }

        if (personaRes.ok) {
          const result = await personaRes.json();
          const personas: PersonaRecord[] = result.data || [];
          setCompanyContactsMap(
            personas.reduce<Record<string, string>>((acc, persona) => {
              if (persona.icp_id) acc[persona.icp_id] = persona.id;
              return acc;
            }, {})
          );
        }
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user]);

  const filteredCompanyProfiles = useMemo(() => {
    if (!preferredIcpId) return companyProfiles;
    return companyProfiles.filter((profile) => profile.id === preferredIcpId);
  }, [companyProfiles, preferredIcpId]);

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-slate-950">
      <AppSidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SetupFlow
          entryPoint="buying-group"
          onCompletePath="/company-criteria"
          companyProfiles={filteredCompanyProfiles}
          companyContactsMap={companyContactsMap}
        />
      </div>
    </div>
  );
}
