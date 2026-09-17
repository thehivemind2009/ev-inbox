import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

// ── Webhook verification (GET) ──────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ── Inbound message handler (POST) ─────────────────────────
export async function POST(req: NextRequest) {
  // Verify signature
  const body = await req.text()
  const sig  = req.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET!)
    .update(body)
    .digest('hex')

  if (sig !== expected) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const payload = JSON.parse(body)

  try {
    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const value  = change?.value

    // Only handle incoming messages (not status updates)
    if (!value?.messages?.length) {
      return NextResponse.json({ ok: true })
    }

    for (const msg of value.messages) {
      const waId   = msg.from          // sender's WhatsApp number
      const text   = msg.text?.body ?? msg.type  // fallback to message type
      const ts     = new Date(parseInt(msg.timestamp) * 1000).toISOString()

      // 1. Upsert contact
      const { data: contact } = await supabaseAdmin
        .from('contacts')
        .upsert({ phone: waId }, { onConflict: 'phone' })
        .select()
        .single()

      if (!contact) continue

      // 2. Find or create open conversation for this contact + channel
      let { data: convo } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('channel', 'whatsapp')
        .eq('status', 'open')
        .maybeSingle()

      if (!convo) {
        const { data: newConvo } = await supabaseAdmin
          .from('conversations')
          .insert({ contact_id: contact.id, channel: 'whatsapp', status: 'open' })
          .select()
          .single()
        convo = newConvo
      }

      if (!convo) continue

      // 3. Insert message
      await supabaseAdmin.from('messages').insert({
        conversation_id: convo.id,
        channel:         'whatsapp',
        direction:       'inbound',
        body:            text,
        timestamp:       ts,
        read:            false,
        raw_payload:     msg,
      })

      // 4. Update conversation last_message_at
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: ts })
        .eq('id', convo.id)
    }
  } catch (err) {
    console.error('[WhatsApp webhook]', err)
  }

  return NextResponse.json({ ok: true })
}
