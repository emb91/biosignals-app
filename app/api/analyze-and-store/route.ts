// app/api/analyze-and-store/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // Get and verify token
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    let user;
    try {
      user = await verifyIdToken(idToken);
    } catch (error) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    console.log('Authenticated user:', user.uid, user.email);

    const { website } = await request.json();

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

    // Call n8n
    console.log('Calling n8n webhook:', n8nWebhookUrl);
    console.log('Payload:', { website });
    
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('n8n webhook failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      return NextResponse.json(
        { 
          error: `Analysis service failed: ${response.status}`,
          details: errorText 
        },
        { status: 502 }
      );
    }

    const rawData = await response.json();
    console.log('Raw n8n response:', JSON.stringify(rawData, null, 2));
    
    const analysisData = rawData[0]?.message?.content;

    if (!analysisData) {
      console.error('Invalid response structure:', {
        hasArray: Array.isArray(rawData),
        hasFirstElement: !!rawData[0],
        hasMessage: !!rawData[0]?.message,
        hasContent: !!rawData[0]?.message?.content,
        rawData: rawData
      });
      return NextResponse.json(
        { 
          error: 'Invalid response from analysis service',
          rawResponse: rawData 
        },
        { status: 500 }
      );
    }

    // Just return the data - don't save it here
    return NextResponse.json({
      ...analysisData,
      user_id: user.uid, // Include user_id so frontend can save it
      user_email: user.email,
    });

  } catch (error) {
    console.error('Error in API route:', error);
    
    // More detailed error logging
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    
    return NextResponse.json(
      { 
        error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        errorType: error instanceof Error ? error.name : typeof error
      },
      { status: 500 }
    );
  }
}

