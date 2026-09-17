import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Postmark inbound webhook — receives parsed email as JSON
export async function POST(req: NextRequest) {
  // Simple bearer token auth for Postmark webhook
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.POSTMARK_WEBHOOK_TOKEN}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const email = await req.json()

  try {
    const fromEmail = email.FromFull?.Email ?? email.From
    const fromName  = email.FromFull?.Name ?? null
    const subject   = email.Subject ?? '(no subject)'
    const textBody  = email.TextBody ?? email.HtmlBody ?? ''
    const ts        = new Date(email.Date ?? Date.now()).toISOString()

    // Compose readable body: subject + message body
    const body = `Subject: ${subject}\n\n${textBody}`.trim()

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .upsert(
        { email: fromEmail, name: fromName },
        { onConflict: 'email' }
      )
      .select()
      .single()

    if (!contact) {
      return NextResponse.json({ ok: false, error: 'contact upsert failed' })
    }

    let { data: convo } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('channel', 'email')
      .eq('status', 'open')
      .maybeSingle()

    if (!convo) {
      const { data: newConvo } = await supabaseAdmin
        .from('conversations')
        .insert({ contact_id: contact.id, channel: 'email', status: 'open' })
        .select()
        .single()
      convo = newConvo
    }

    if (!convo) {
      return NextResponse.json({ ok: false, error: 'conversation create failed' })
    }

    await supabaseAdmin.from('messages').insert({
      conversation_id: convo.id,
      channel:         'email',
      direction:       'inbound',
      body,
      timestamp:       ts,
      read:            false,
      raw_payload:     email,
    })

    await supabaseAdmin
      .from('conversations')
      .update({ last_message_at: ts })
      .eq('id', convo.id)
  } catch (err) {
    console.error('[Email webhook]', err)
  }

  return NextResponse.json({ ok: true })
}
