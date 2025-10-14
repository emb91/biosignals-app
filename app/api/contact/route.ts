import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('Received form data:', body);  // Log received data
    
    const { name, email, company, message } = body;

    // Validate required fields
    if (!name || !email || !message) {
      console.log('Missing required fields:', { name, email, message });
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Prepare Airtable API call
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_CONTACT_TABLE_ID = process.env.AIRTABLE_CONTACT_TABLE_ID;

    // Log environment variables (without revealing full API key)
    console.log('Environment variables check:', {
      hasApiKey: !!AIRTABLE_API_KEY,
      hasBaseId: !!AIRTABLE_BASE_ID,
      hasTableId: !!AIRTABLE_CONTACT_TABLE_ID,
      tableId: AIRTABLE_CONTACT_TABLE_ID
    });

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_CONTACT_TABLE_ID) {
      console.error('Missing environment variables');
      return NextResponse.json({ error: 'Airtable environment variables not set.' }, { status: 500 });
    }

    const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CONTACT_TABLE_ID}`;
    console.log('Airtable URL:', airtableUrl);

    // Format date as YYYY-MM-DD
    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];

    // Map form fields to Airtable fields - exactly matching column names from Airtable
    const fields: Record<string, any> = {
      'Name': name,
      'Email': email,
      'Company name (optional)': company || '',
      'What\'s on your mind?': message,
    };

    console.log('Sending to Airtable:', fields);

    // Send to Airtable
    const airtableRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    const responseText = await airtableRes.text();
    console.log('Airtable response:', {
      status: airtableRes.status,
      statusText: airtableRes.statusText,
      response: responseText
    });

    if (!airtableRes.ok) {
      console.error('Airtable Error:', responseText);
      return NextResponse.json({ 
        error: 'Failed to submit to Airtable: ' + responseText,
        details: {
          status: airtableRes.status,
          statusText: airtableRes.statusText
        }
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Server Error:', error);
    // Return more detailed error information
    return NextResponse.json({ 
      error: 'Server error.',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

// Only allow POST
export const dynamic = 'force-dynamic'; 