'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast, Toaster } from 'sonner';
import { getSignalDisplayName } from '@/lib/signal-display-names';

interface Contact {
  id: string;
  name: string;
  functions: string[];
  seniority_levels: string[];
  job_titles: string[];
  signals: string[];
  icp_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CompanyProfile {
  id: string;
  name: string;
}

export default function ContactsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<CompanyProfile[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getCompanyName = (icpId: string | null) => {
    if (!icpId) return null;
    const company = companyProfiles.find(c => c.id === icpId);
    return company?.name || null;
  };

  // Parse weighted functions (stored as JSON strings) to get display names
  const parseFunctions = (functions: string[]): string[] => {
    if (!functions) return [];
    return functions.map(f => {
      try {
        const parsed = JSON.parse(f);
        return parsed.name || f;
      } catch {
        return f;
      }
    });
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [contactsRes, companiesRes] = await Promise.all([
          fetch('/api/contacts'),
          fetch('/api/companies'),
        ]);
        
        if (contactsRes.ok) {
          const result = await contactsRes.json();
          setContacts(result.data || []);
        }
        
        if (companiesRes.ok) {
          const result = await companiesRes.json();
          setCompanyProfiles(result.data || []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load buyer personas');
      } finally {
        setLoadingContacts(false);
      }
    };

    if (user) {
      fetchData();
    }
  }, [user]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this buyer persona?')) {
      return;
    }

    try {
      const response = await fetch(`/api/contacts/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setContacts(contacts.filter(c => c.id !== id));
        toast.success('Buyer persona deleted');
      } else {
        throw new Error('Failed to delete');
      }
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Failed to delete buyer persona');
    }
  };

  if (loading) {
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
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Who do you sell to?</h1>
              <p className="text-gray-600 mt-1">Define the people you typically sell to. We’ll characterize these groups of people (personas) here, and use these profiles to surface the right contacts at your target companies.</p>
            </div>

            {/* Contacts List */}
            {loadingContacts ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal"></div>
              </div>
            ) : contacts.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No buyer personas yet</h3>
                <p className="text-gray-500 mb-6">Get started by defining your first buyer persona.</p>
                <button
                  onClick={() => router.push('/personas/new')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  + Create new persona
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="space-y-4">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="rounded-lg border border-gray-200 overflow-hidden"
                    >
                    <div
                      className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setExpandedId(expandedId === contact.id ? null : contact.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{contact.name}</h3>
                          {getCompanyName(contact.icp_id) && (
                            <p className="text-sm text-arcova-teal mt-0.5">
                              {getCompanyName(contact.icp_id)}
                            </p>
                          )}
                          <p className="text-sm text-gray-500 mt-1">
                            {parseFunctions(contact.functions)?.slice(0, 2).join(', ')}
                            {contact.functions?.length > 2 && ` +${contact.functions.length - 2} more`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/personas/${contact.id}/edit`);
                            }}
                            className="p-2 text-arcova-teal hover:bg-arcova-teal/10 rounded transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(contact.id);
                            }}
                            className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                          <svg
                            className={`w-5 h-5 text-gray-400 transition-transform ${expandedId === contact.id ? 'rotate-180' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {expandedId === contact.id && (
                      <div className="px-4 pb-4 border-t border-gray-100 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Teams</h4>
                            <div className="flex flex-wrap gap-1">
                              {parseFunctions(contact.functions)?.map((func) => (
                                <span key={func} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                                  {func}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Seniority</h4>
                            <div className="flex flex-wrap gap-1">
                              {contact.seniority_levels?.map((level) => (
                                <span key={level} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                                  {level}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Job Titles</h4>
                            <div className="flex flex-wrap gap-1">
                              {contact.job_titles?.map((title) => (
                                <span key={title} className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                                  {title}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Signals</h4>
                            <div className="flex flex-wrap gap-1">
                              {contact.signals?.length > 0 ? (
                                contact.signals.map((signal) => (
                                  <span key={signal} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">
                                    {getSignalDisplayName(signal)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-gray-400">Not set</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  ))}

                  {/* Create New Button */}
                  <button
                    onClick={() => router.push('/personas/new')}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-gray-500 hover:border-arcova-teal hover:text-arcova-teal transition-colors flex items-center justify-center mt-4"
                  >
                    + Create new persona
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </div>
  );
}
