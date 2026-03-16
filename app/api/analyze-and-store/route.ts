import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { website } = await request.json()

    if (!website) {
      return NextResponse.json(
        { error: 'Website URL is required' },
        { status: 400 }
      )
    }

    const n8nWebhookUrl = process.env.N8N_COMPANY_ANALYSIS_WEBHOOK
    
    if (!n8nWebhookUrl) {
      return NextResponse.json(
        { error: 'Analysis service is not configured' },
        { status: 500 }
      )
    }

    // Call n8n with timeout
    console.log('Calling n8n webhook:', n8nWebhookUrl)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minute timeout
    
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website }),
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('n8n webhook failed:', response.status, errorText)
      return NextResponse.json(
        { error: `Analysis service failed: ${response.status}` },
        { status: 502 }
      )
    }

    const rawData = await response.json()
    console.log('Raw n8n response:', JSON.stringify(rawData, null, 2))
    
    // Parse n8n response (try multiple structures)
    let analysisData
    if (rawData[0]?.message?.content) {
      analysisData = rawData[0].message.content
    } else if (rawData[0]?.json) {
      analysisData = rawData[0].json
    } else if (rawData[0] && typeof rawData[0] === 'object') {
      analysisData = rawData[0]
    } else if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      analysisData = rawData
    }

    if (!analysisData || Object.keys(analysisData).length === 0) {
      return NextResponse.json(
        { error: 'Invalid response from analysis service' },
        { status: 500 }
      )
    }

    // Check if user already has an analysis
    const { data: existing } = await supabase
      .from('company_analyses')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    let result
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('company_analyses')
        .update({
          ...analysisData,
          website,
          analyzed_at: new Date().toISOString(),
          status: 'completed',
        })
        .eq('id', existing.id)
        .select()
        .single()
      
      if (error) throw error
      result = data
    } else {
      // Insert new
      const { data, error } = await supabase
        .from('company_analyses')
        .insert({
          user_id: user.id,
          user_email: user.email,
          ...analysisData,
          website,
          analyzed_at: new Date().toISOString(),
          status: 'completed',
        })
        .select()
        .single()
      
      if (error) throw error
      result = data
    }

    return NextResponse.json(result)

  } catch (error) {
    console.error('Error in API route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
