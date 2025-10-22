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

    // Call n8n with timeout
    console.log('Calling n8n webhook:', n8nWebhookUrl);
    console.log('Payload:', { website });
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
    
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

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
    
    // Try multiple possible response structures
    let analysisData;
    
    // Try: rawData[0]?.message?.content
    if (rawData[0]?.message?.content) {
      analysisData = rawData[0].message.content;
      console.log('Found data in rawData[0].message.content');
    }
    // Try: rawData[0]?.json (common n8n format)
    else if (rawData[0]?.json) {
      analysisData = rawData[0].json;
      console.log('Found data in rawData[0].json');
    }
    // Try: rawData[0] directly
    else if (rawData[0] && typeof rawData[0] === 'object') {
      analysisData = rawData[0];
      console.log('Found data in rawData[0]');
    }
    // Try: rawData directly (not an array)
    else if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      analysisData = rawData;
      console.log('Found data in rawData (not array)');
    }

    if (!analysisData || Object.keys(analysisData).length === 0) {
      console.error('Invalid response structure:', {
        isArray: Array.isArray(rawData),
        hasFirstElement: !!rawData[0],
        firstElementKeys: rawData[0] ? Object.keys(rawData[0]) : [],
        rawDataKeys: typeof rawData === 'object' ? Object.keys(rawData) : [],
        rawData: rawData
      });
      return NextResponse.json(
        { 
          error: 'Invalid response from analysis service - no valid data found',
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

