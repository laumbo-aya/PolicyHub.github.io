import { withSupabase } from 'npm:@supabase/server@1'

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed.' }, { status: 405 })
    }

    const { data: profile, error: profileError } = await context.supabase
      .from('profiles')
      .select('role,is_active')
      .eq('id', context.userClaims.sub)
      .single()

    if (profileError || profile?.role !== 'admin' || !profile.is_active) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 })
    }

    let input: { email?: string; user_code?: string; user_name?: string; department?: string }
    try {
      input = await request.json()
    } catch {
      return Response.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const email = String(input.email || '').trim().toLowerCase()
    const userCode = String(input.user_code || '').trim()
    const userName = String(input.user_name || '').trim()
    const department = String(input.department || '').trim()
    if (!email || !email.includes('@') || !userCode || !userName || !department) {
      return Response.json({ error: 'Enter a valid email, User ID, name, and department.' }, { status: 400 })
    }

    const siteUrl = Deno.env.get('POLICYHUB_SITE_URL')
    if (!siteUrl) {
      return Response.json({ error: 'Set POLICYHUB_SITE_URL in Supabase Edge Function secrets.' }, { status: 500 })
    }

    const { data, error } = await context.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { user_code: userCode, user_name: userName, department },
      redirectTo: new URL('reset-password.html', siteUrl).href,
    })

    if (error) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ invited: true, user_id: data.user?.id })
  }),
}
