import { NextRequest, NextResponse } from 'next/server';

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

    // Get the n8n webhook URL from environment variables
    const n8nWebhookUrl = process.env.N8N_COMPANY_ANALYSIS_WEBHOOK;
    console.log('n8n webhook URL:', n8nWebhookUrl);

    if (!n8nWebhookUrl) {
      console.error('N8N_COMPANY_ANALYSIS_WEBHOOK environment variable is not set');
      return NextResponse.json(
        { error: 'Analysis service is not configured' },
        { status: 500 }
      );
    }

    console.log('Sending request to n8n webhook...');
    
    // Forward the request to n8n webhook
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ website }),
    });

    console.log('n8n response status:', response.status);
    console.log('n8n response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('n8n webhook failed:', response.status, response.statusText, errorText);
      return NextResponse.json(
        { error: `Analysis service is currently unavailable: ${response.status} ${response.statusText}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    console.log('n8n response data:', data);
    return NextResponse.json(data);

  } catch (error) {
    console.error('Error in analyze-company API:', error);
    return NextResponse.json(
      { error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
