import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { conversationId, text } = await req.json()

  if (!conversationId || !text) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Get conversation + contact
  const { data: convo } = await supabaseAdmin
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .single()

  if (!convo) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const ts = new Date().toISOString()

  // Send via the right channel
  if (convo.channel === 'whatsapp') {
    const phone = (convo as any).contact?.phone
    if (!phone) return NextResponse.json({ error: 'No phone' }, { status: 400 })

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/\D/g, ''),
          type: 'text',
          text: { body: text },
        }),
      }
    )

    if (!res.ok) {
      const err = await res.text()
      console.error('[Send WhatsApp]', err)
      return NextResponse.json({ error: err }, { status: 500 })
    }
  }

  // TODO: add Messenger and Instagram send via Graph API (same pattern)
  // TODO: add Email send via Postmark API

  // Save outbound message to DB
  await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    channel:         convo.channel,
    direction:       'outbound',
    body:            text,
    timestamp:       ts,
    read:            true,
    raw_payload:     {},
  })

  await supabaseAdmin
    .from('conversations')
    .update({ last_message_at: ts })
    .eq('id', conversationId)

  return NextResponse.json({ ok: true })
}
