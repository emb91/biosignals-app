import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { verifyIdToken } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    // Get the ID token from the Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No authorization header');
      return NextResponse.json(
        { error: 'Authorization header with Bearer token required' },
        { status: 401 }
      );
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the ID token
    let decodedToken;
    try {
      decodedToken = await verifyIdToken(idToken);
      console.log('Verified user token:', decodedToken.uid);
    } catch (tokenError) {
      console.error('Token verification failed:', tokenError);
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }
    
    const userId = decodedToken.uid;

    // Query Firestore for user's analyses
    console.log('Querying Firestore for user:', userId);
    const analysesRef = collection(db, 'company_analyses');
    const q = query(
      analysesRef,
      where('user_id', '==', userId)
    );

    const querySnapshot = await getDocs(q);
    console.log('Found documents:', querySnapshot.size);
    
    const analyses = querySnapshot.docs
      .map(doc => {
        const data = doc.data();
        console.log('Document data:', doc.id, data);
        return {
          id: doc.id,
          ...data
        };
      })
      .sort((a, b) => {
        // Sort by analyzed_at in descending order (most recent first)
        const aTime = a.analyzed_at?.seconds || 0;
        const bTime = b.analyzed_at?.seconds || 0;
        return bTime - aTime;
      });

    console.log('Returning analyses:', analyses.length);
    return NextResponse.json({ analyses });
  } catch (error) {
    console.error('Error fetching user analyses:', error);
    console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { error: 'Failed to fetch analyses', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}