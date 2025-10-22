// app/api/analyze-and-store/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase'; // Your Firebase config
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

export async function POST(request: NextRequest) {
  try {
    const { website } = await request.json();
    console.log('Received website:', website);

    if (!website) {
      return NextResponse.json(
        { error: 'Website URL is required' },
        { status: 400 }
      );
    }

    const n8nWebhookUrl = process.env.N8N_COMPANY_ANALYSIS_WEBHOOK;
    
    if (!n8nWebhookUrl) {
      return NextResponse.json(
        { error: 'Analysis service is not configured' },
        { status: 500 }
      );
    }

    console.log('Sending request to n8n webhook...');
    
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ website }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('n8n webhook failed:', response.status, errorText);
      return NextResponse.json(
        { error: `Analysis service failed: ${response.status}` },
        { status: 502 }
      );
    }

    const rawData = await response.json();
    console.log('Raw n8n response:', JSON.stringify(rawData, null, 2));

    // Try different possible data structures
    let analysisData;
    
    // Check if it's in rawData[0]?.message?.content
    if (rawData[0]?.message?.content) {
      analysisData = rawData[0].message.content;
      console.log('Found data in rawData[0].message.content');
    }
    // Check if it's directly in rawData[0]
    else if (rawData[0]) {
      analysisData = rawData[0];
      console.log('Found data in rawData[0]');
    }
    // Check if it's directly in rawData
    else if (rawData && typeof rawData === 'object') {
      analysisData = rawData;
      console.log('Found data in rawData');
    }

    console.log('Extracted analysisData:', JSON.stringify(analysisData, null, 2));

    if (!analysisData || Object.keys(analysisData).length === 0) {
      console.error('No valid data found in response structure');
      return NextResponse.json(
        { error: 'Invalid response from analysis service', rawResponse: rawData },
        { status: 500 }
      );
    }

    // Store in Firebase
    const docRef = await addDoc(collection(db, 'company_analyses'), {
      ...analysisData,
      analyzed_at: serverTimestamp(),
      status: 'completed'
    });

    console.log('Stored in Firebase with ID:', docRef.id);

    // Return the data with the Firebase document ID
    return NextResponse.json({
      id: docRef.id,
      ...analysisData
    });

  } catch (error) {
    console.error('Error in analyze-and-store API:', error);
    return NextResponse.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

