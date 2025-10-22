# User Analysis Implementation - Single Document Per User

## Overview
Each user has ONE company analysis document in Firestore that persists and gets updated on re-analysis.

## Implementation Details

### Frontend Changes (`app/about/page.tsx`)

#### 1. Added Imports
```typescript
import { collection, addDoc, serverTimestamp, updateDoc, getDocs, query, where, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
```

#### 2. Load Existing Analysis on Mount
```typescript
useEffect(() => {
  const loadExistingAnalysis = async () => {
    if (!user) return;
    
    const q = query(
      collection(db, 'company_analyses'),
      where('user_id', '==', user.uid),
      limit(1)
    );
    
    const existingDocs = await getDocs(q);
    
    if (!existingDocs.empty) {
      // Display existing analysis
      const existingData = existingDocs.docs[0].data();
      setAnalysisResults({ id: existingDocs.docs[0].id, ...existingData });
      setWebsiteUrl(existingData.website || '');
    }
  };
  
  loadExistingAnalysis();
}, [user]);
```

#### 3. Update vs Create Logic
```typescript
const handleAnalyze = async (e: React.FormEvent) => {
  // ... API call to get analysis data ...
  
  // Check if user already has an analysis document
  const q = query(
    collection(db, 'company_analyses'),
    where('user_id', '==', currentUser.uid),
    limit(1)
  );
  
  const existingDocs = await getDocs(q);
  
  if (!existingDocs.empty) {
    // UPDATE existing document
    const existingDocRef = existingDocs.docs[0].ref;
    await updateDoc(existingDocRef, {
      ...data,
      analyzed_at: serverTimestamp(),
      status: 'completed',
    });
  } else {
    // CREATE new document (first time only)
    docRef = await addDoc(collection(db, 'company_analyses'), {
      ...data,
      analyzed_at: serverTimestamp(),
      status: 'completed',
    });
  }
};
```

#### 4. Loading States
- `loading` - Authentication loading
- `loadingExisting` - Loading existing analysis on mount
- `isAnalyzing` - Running new analysis

### API Route (`app/api/analyze-and-store/route.ts`)

**Purpose**: Verify user authentication and call n8n for analysis

```typescript
export async function POST(request: NextRequest) {
  // 1. Verify user token
  const authHeader = request.headers.get('Authorization');
  const idToken = authHeader.split('Bearer ')[1];
  const user = await verifyIdToken(idToken);
  
  // 2. Call n8n webhook
  const response = await fetch(n8nWebhookUrl, {
    method: 'POST',
    body: JSON.stringify({ website }),
  });
  
  const analysisData = await response.json();
  
  // 3. Return data with user info (frontend saves to Firestore)
  return NextResponse.json({
    ...analysisData,
    user_id: user.uid,
    user_email: user.email,
  });
}
```

### Firestore Security Rules (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /company_analyses/{docId} {
      // Users can only read their own analyses
      allow read: if request.auth != null && resource.data.user_id == request.auth.uid;
      
      // Users can create analyses (must set user_id to their own uid)
      allow create: if request.auth != null && request.resource.data.user_id == request.auth.uid;
      
      // Users can update/delete their own analyses
      allow update, delete: if request.auth != null && resource.data.user_id == request.auth.uid;
    }
  }
}
```

## Data Flow

1. **User Logs In** → Firebase Authentication
2. **Page Loads** → Check for existing analysis → Display if found
3. **User Analyzes Company**:
   - Frontend gets ID token
   - API verifies token + calls n8n → Returns analysis data with user_id
   - Frontend checks for existing document
   - If exists: UPDATE document
   - If not: CREATE new document
4. **Data Persists** → User sees same analysis on reload

## Benefits

✅ **No Duplicates** - Only one document per user
✅ **Persists Data** - Analysis survives page reloads
✅ **Secure** - User can only access their own data
✅ **Clean Updates** - Re-analyzing overwrites existing data
✅ **Efficient** - No need to clean up old analyses

## Testing Checklist

- [ ] User can analyze a company (creates first document)
- [ ] Analysis persists on page reload
- [ ] Re-analyzing updates the same document (no duplicates)
- [ ] Different users see only their own analyses
- [ ] Security rules prevent cross-user access

## Future Enhancements

- Support multiple analyses per user (add company identifier)
- Add analysis history (keep previous versions)
- Add delete functionality
- Add export/share features

