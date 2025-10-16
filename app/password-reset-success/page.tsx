'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PasswordResetSuccessPage() {
  const router = useRouter();

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
