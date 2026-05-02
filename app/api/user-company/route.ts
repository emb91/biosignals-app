import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import {
  normalizePlatformTaxonomyFields,
  parsePlatformCategoryInput,
} from '@/lib/platform-category'
import {
  isMissingColumnError,
  withoutPlatformCategory,
} from '@/lib/supabase-column-compat'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: analyses, error } = await supabase
      .from('user_company')
      .select('*')
      .eq('user_id', user.id)
      .order('analyzed_at', { ascending: false })

    if (error) {
      console.error('Error fetching user company:', error)
      return NextResponse.json(
        { error: 'Failed to fetch user company' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      analyses: (analyses ?? []).map((analysis) =>
        normalizePlatformTaxonomyFields(analysis as Record<string, unknown>),
      ),
    })

  } catch (error) {
    console.error('Error in user-company API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      )
    }

    const normalizedUpdateData: Record<string, unknown> = { ...updateData }
    if (
      Object.prototype.hasOwnProperty.call(updateData, 'platform_category') ||
      Object.prototype.hasOwnProperty.call(updateData, 'platformCategory')
    ) {
      const rawPlatformCategory =
        Object.prototype.hasOwnProperty.call(updateData, 'platform_category')
          ? updateData.platform_category
          : updateData.platformCategory
      const { value: platformCategory, error: platformCategoryError } =
        parsePlatformCategoryInput(rawPlatformCategory)

      if (platformCategoryError) {
        return NextResponse.json(
          { error: platformCategoryError },
          { status: 400 }
        )
      }

      normalizedUpdateData.platform_category = platformCategory
      delete normalizedUpdateData.platformCategory
    }

    const updatePayload = {
      ...normalizedUpdateData,
      updated_at: new Date().toISOString(),
    }

    let result = await supabase
      .from('user_company')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase
        .from('user_company')
        .update(withoutPlatformCategory(updatePayload))
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()
    }

    const { data, error } = result

    if (error) {
      console.error('Error updating user company:', error)
      return NextResponse.json(
        { error: 'Failed to update user company' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      normalizePlatformTaxonomyFields(data as Record<string, unknown>)
    )

  } catch (error) {
    console.error('Error in user-company PUT:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('user_company')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting user company:', error)
      return NextResponse.json(
        { error: 'Failed to delete user company' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in user-company DELETE:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
