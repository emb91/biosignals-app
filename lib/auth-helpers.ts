import { getAuth } from 'firebase/auth';

// Get the current user's ID token
export async function getCurrentUserToken() {
  const auth = getAuth();
  const user = auth.currentUser;
  
  if (!user) {
    throw new Error('No user logged in');
  }
  
  return await user.getIdToken();
}

// Verify token server-side (without Firebase Admin SDK)
export async function verifyIdToken(idToken: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    throw new Error('Invalid token');
  }

  const data = await response.json();
  
  if (!data.users || data.users.length === 0) {
    throw new Error('User not found');
  }
  
  return {
    uid: data.users[0].localId,
    email: data.users[0].email,
  };
}
