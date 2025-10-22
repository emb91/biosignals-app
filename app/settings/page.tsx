'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { User, Mail, Building2, Linkedin, Save } from 'lucide-react';
import { sendPasswordResetEmail, updateProfile, deleteUser } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit, deleteDoc, writeBatch } from 'firebase/firestore';

export default function SettingsPage() {
  const { user, loading, refreshUserProfile } = useAuth();
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    company: '',
    linkedinSlug: '', // Just the username part
  });
  
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetError, setResetError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      try {
        // Load user profile from Firestore
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        let companyName = '';
        
        // Try to get company name from analysis if not in profile
        if (!userDoc.exists() || !userDoc.data()?.company) {
          const analysesRef = collection(db, 'company_analyses');
          const q = query(
            analysesRef,
            where('user_id', '==', user.uid),
            limit(1)
          );
          const analysisSnapshot = await getDocs(q);
          
          if (!analysisSnapshot.empty) {
            const analysisData = analysisSnapshot.docs[0].data();
            companyName = analysisData.company_name || '';
          }
        }

        if (userDoc.exists()) {
          const userData = userDoc.data();
          // Extract slug from full URL if it exists
          let slug = userData.linkedinSlug || '';
          if (userData.linkedinUrl && !slug) {
            // Extract from old format
            const match = userData.linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/);
            slug = match ? match[1] : '';
          }
          
          setFormData({
            displayName: userData.displayName || user.displayName || '',
            email: user.email || '',
            company: userData.company || companyName,
            linkedinSlug: slug,
          });
        } else {
          // First time - populate with defaults
          setFormData({
            displayName: user.displayName || '',
            email: user.email || '',
            company: companyName,
            linkedinSlug: '',
          });
        }
      } catch (error) {
        console.error('Error loading user data:', error);
        setFormData(prev => ({
          ...prev,
          displayName: user.displayName || '',
          email: user.email || '',
        }));
      }
    };

    loadUserData();
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async () => {
    if (!user) return;
    
    setIsSaving(true);
    setSaveSuccess(false);
    
    try {
      // Save to Firestore
      const userDocRef = doc(db, 'users', user.uid);
      const linkedinUrl = formData.linkedinSlug 
        ? `https://www.linkedin.com/in/${formData.linkedinSlug}`
        : '';
      
      await setDoc(userDocRef, {
        displayName: formData.displayName,
        company: formData.company,
        linkedinSlug: formData.linkedinSlug,
        linkedinUrl: linkedinUrl, // Store full URL for easy access
        email: user.email,
        updatedAt: new Date(),
      }, { merge: true });
      
      // Refresh the user profile in AuthContext
      await refreshUserProfile();
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    
    setResetEmailSent(false);
    setResetError('');
    
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 5000);
    } catch (error: any) {
      console.error('Error sending password reset email:', error);
      setResetError('Failed to send reset email. Please try again.');
      setTimeout(() => setResetError(''), 5000);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    
    setIsDeleting(true);
    
    try {
      // Delete user's Firestore data first
      const batch = writeBatch(db);
      
      // Delete user profile
      const userDocRef = doc(db, 'users', user.uid);
      batch.delete(userDocRef);
      
      // Delete user's company analyses
      const analysesRef = collection(db, 'company_analyses');
      const q = query(analysesRef, where('user_id', '==', user.uid));
      const querySnapshot = await getDocs(q);
      
      querySnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      // Delete Firebase Auth user
      await deleteUser(user);
      
      // Redirect to home
      router.push('/');
    } catch (error: any) {
      console.error('Error deleting account:', error);
      
      // Check if re-authentication is required
      if (error.code === 'auth/requires-recent-login') {
        alert('For security, please log out and log back in before deleting your account.');
      } else {
        alert('Failed to delete account: ' + (error.message || 'Please try again or contact support.'));
      }
      
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
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
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Account Settings</h1>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              {/* Profile Section */}
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-6">Profile Information</h2>
                
                <div className="space-y-6">
                  {/* Display Name */}
                  <div>
                    <label htmlFor="displayName" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <User className="w-4 h-4 text-gray-500" />
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="displayName"
                      name="displayName"
                      value={formData.displayName}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                      placeholder="Enter your full name"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="email" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Mail className="w-4 h-4 text-gray-500" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                      placeholder="your.email@example.com"
                    />
                    <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                  </div>

                  {/* Company */}
                  <div>
                    <label htmlFor="company" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Building2 className="w-4 h-4 text-gray-500" />
                      Company
                    </label>
                    <input
                      type="text"
                      id="company"
                      name="company"
                      value={formData.company}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                      placeholder="Enter your company name"
                    />
                  </div>

                  {/* LinkedIn URL */}
                  <div>
                    <label htmlFor="linkedinSlug" className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Linkedin className="w-4 h-4 text-gray-500" />
                      LinkedIn Profile
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm whitespace-nowrap">
                        linkedin.com/in/
                      </span>
                      <input
                        type="text"
                        id="linkedinSlug"
                        name="linkedinSlug"
                        value={formData.linkedinSlug}
                        onChange={handleChange}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-arcova-teal focus:border-transparent"
                        placeholder="yourprofile"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Just enter your LinkedIn username (e.g., "john-smith-123")
                    </p>
                  </div>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex items-center justify-between pt-6 border-t border-gray-200">
                <div>
                  {saveSuccess && (
                    <span className="text-green-600 text-sm flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                      Settings saved successfully
                    </span>
                  )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-6 py-2 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Account Actions */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mt-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Account Actions</h2>
              
              <div className="space-y-4">
                <div className="border border-gray-300 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 mb-1">Change Password</div>
                      <div className="text-sm text-gray-500 mb-3">
                        We'll send a password reset link to {user?.email}
                      </div>
                      {resetEmailSent && (
                        <div className="text-sm text-green-600 flex items-center gap-2 mb-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                          </svg>
                          Password reset email sent! Check your inbox.
                        </div>
                      )}
                      {resetError && (
                        <div className="text-sm text-red-600 mb-2">
                          {resetError}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handlePasswordReset}
                      className="ml-4 px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
                    >
                      Send Reset Link
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-white rounded-lg shadow-sm border border-red-200 p-8 mt-6">
              <h2 className="text-xl font-semibold text-red-900 mb-6">Danger Zone</h2>
              
              <div className="border border-red-300 rounded-lg p-4 bg-red-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-red-900 mb-1">Delete Account</div>
                    <div className="text-sm text-red-700 mb-3">
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </div>
                    {showDeleteConfirm && (
                      <div className="bg-white border border-red-300 rounded-lg p-4 mb-3">
                        <p className="text-sm text-red-900 font-medium mb-3">
                          Are you absolutely sure? This will:
                        </p>
                        <ul className="text-sm text-red-700 space-y-1 mb-4 ml-4 list-disc">
                          <li>Delete your account permanently</li>
                          <li>Remove all your company analyses</li>
                          <li>Erase your profile information</li>
                        </ul>
                        <div className="flex gap-2">
                          <button
                            onClick={handleDeleteAccount}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                          >
                            {isDeleting ? 'Deleting...' : 'Yes, Delete My Account'}
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(false)}
                            disabled={isDeleting}
                            className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {!showDeleteConfirm && (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="ml-4 px-4 py-2 text-sm border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                    >
                      Delete Account
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

