'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { confirmPasswordReset } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oobCode, setOobCode] = useState<string | null>(null);
  
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('oobCode');
    if (code) {
      setOobCode(code);
    } else {
      setError('Invalid or expired reset link.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (!oobCode) {
      setError('Invalid reset link.');
      return;
    }

    setLoading(true);

    try {
      // Use Firebase's secure confirmPasswordReset function
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
    } catch (error: any) {
      if (error.code === 'auth/expired-action-code') {
        setError('This reset link has expired. Please request a new one.');
      } else if (error.code === 'auth/invalid-action-code') {
        setError('Invalid reset link. Please request a new one.');
      } else if (error.code === 'auth/weak-password') {
        setError('Password is too weak. Please choose a stronger password.');
      } else {
        setError(error.message || 'Failed to reset password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-arcova-mint/10 via-white to-arcova-teal/5">
        <div className="flex items-center justify-center min-h-screen py-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-md w-full space-y-8">
            {/* Arcova Branding Header */}
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center space-x-3">
                <div className="w-12 h-12 bg-arcova-teal rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold text-xl">A</span>
                </div>
                <span className="text-3xl font-bold text-arcova-darkblue">Arcova</span>
              </div>
              <div className="w-16 h-1 bg-arcova-teal rounded-full mx-auto"></div>
            </div>

            <Card className="shadow-xl border-0 bg-white/95 backdrop-blur-sm">
              <CardHeader className="text-center pb-6">
                <CardTitle className="text-3xl font-bold text-arcova-darkblue mb-2">
                  Password Reset Successful! 🎉
                </CardTitle>
                <CardDescription className="text-lg text-gray-600">
                  Your Arcova account password has been updated
                </CardDescription>
              </CardHeader>
              <CardContent className="px-8 pb-8">
                <div className="text-center space-y-6">
                  <div className="text-arcova-teal">
                    <svg className="mx-auto h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-gray-600 text-lg">
                    You can now sign in with your new password.
                  </p>
                  <Button
                    onClick={() => router.push('/login')}
                    className="w-full h-12 bg-arcova-teal hover:bg-arcova-teal/90 text-white font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    Go to Sign In
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="text-center text-sm text-gray-500">
              <p>Powered by <span className="text-arcova-teal font-semibold">Arcova Signals</span></p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-arcova-mint/10 via-white to-arcova-teal/5">
      <div className="flex items-center justify-center min-h-screen py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          {/* Arcova Branding Header */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center space-x-3">
              <div className="w-12 h-12 bg-arcova-teal rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xl">A</span>
              </div>
              <span className="text-3xl font-bold text-arcova-darkblue">Arcova</span>
            </div>
            <div className="w-16 h-1 bg-arcova-teal rounded-full mx-auto"></div>
          </div>

          <Card className="shadow-xl border-0 bg-white/95 backdrop-blur-sm">
            <CardHeader className="text-center pb-6">
              <CardTitle className="text-3xl font-bold text-arcova-darkblue mb-2">
                Reset Your Password
              </CardTitle>
              <CardDescription className="text-lg text-gray-600">
                Create a new secure password for your Arcova account
              </CardDescription>
            </CardHeader>
            <CardContent className="px-8 pb-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <Alert variant="destructive" className="border-red-200 bg-red-50">
                    <AlertDescription className="text-red-800">{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-5">
                  <div>
                    <Label htmlFor="password" className="text-arcova-darkblue font-semibold">
                      New Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="mt-2 h-12 border-2 border-gray-200 focus:border-arcova-teal focus:ring-arcova-teal/20 rounded-xl"
                      placeholder="Enter your new password"
                    />
                  </div>

                  <div>
                    <Label htmlFor="confirmPassword" className="text-arcova-darkblue font-semibold">
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="mt-2 h-12 border-2 border-gray-200 focus:border-arcova-teal focus:ring-arcova-teal/20 rounded-xl"
                      placeholder="Confirm your new password"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-arcova-teal hover:bg-arcova-teal/90 text-white font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl transition-all duration-300"
                  disabled={loading}
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                      Resetting Password...
                    </div>
                  ) : (
                    'Reset Password'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="text-center text-sm text-gray-500">
            <p>Powered by <span className="text-arcova-teal font-semibold">Arcova Signals</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
