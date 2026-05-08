'use client';

import Link from 'next/link';
import AppSidebar from '@/components/AppSidebar';
import { ROUTES } from '@/lib/routes';

export default function FindMoreLeadsPage() {
  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <h1 className="text-3xl font-bold text-gray-900">Find more leads matching this team</h1>
          <p className="mt-3 text-gray-600">
            Arcova can help you go beyond your existing CRM by finding net-new contacts that match the
            teams you already care about.
          </p>
          <p className="mt-3 text-gray-600">
            This Phase 2 workflow is the next step after import-based prioritisation. For now, use your
            current Leads view to work the enriched contacts that are already ready to action.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={ROUTES.leads.contacts}
              className="px-4 py-2 rounded-lg bg-arcova-teal text-white text-sm font-medium hover:bg-arcova-teal/90 transition-colors"
            >
              View Leads
            </Link>
            <Link
              href={ROUTES.import}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
            >
              Back to import summary
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
