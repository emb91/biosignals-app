import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { verifyIdToken } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    // Get the ID token from the Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization header with Bearer token required' },
        { status: 401 }
      );
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the ID token
    const decodedToken = await verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Query Firestore for user's analyses
    const analysesRef = collection(db, 'company_analyses');
    const q = query(
      analysesRef,
      where('user_id', '==', userId)
    );

    const querySnapshot = await getDocs(q);
    const analyses = querySnapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .sort((a, b) => {
        // Sort by analyzed_at in descending order (most recent first)
        const aTime = a.analyzed_at?.seconds || 0;
        const bTime = b.analyzed_at?.seconds || 0;
        return bTime - aTime;
      });

    return NextResponse.json({ analyses });
  } catch (error) {
    console.error('Error fetching user analyses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analyses' },
      { status: 500 }
    );
  }
}