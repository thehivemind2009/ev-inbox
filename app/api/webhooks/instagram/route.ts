import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  // Read raw bytes — avoids any string-encoding normalisation Netlify may apply
  const rawBody = await req.arrayBuffer()
  const bodyBuf = Buffer.from(rawBody)
  const body = bodyBuf.toString('utf8')

  const sig = req.headers.get('x-hub-signature-256') ?? ''
  const secret = process.env.INSTAGRAM_APP_SECRET ?? ''

  // Compute HMAC on raw bytes (not re-encoded string)
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(bodyBuf)
    .digest('hex')

  // DEBUG logging — full signatures + base64 body for offline HMAC verification
  console.log('[Instagram webhook] debug secretLen:', secret.length, 'secretPrefix:', secret.slice(0, 6))
  console.log('[Instagram webhook] debug bodyLen:', bodyBuf.length, 'bodyPrefix:', body.slice(0, 60))
  console.log('[Instagram webhook] debug bodyBase64:', bodyBuf.toString('base64'))
  console.log('[Instagram webhook] debug sigReceived:', sig)
  console.log('[Instagram webhook] debug sigExpected:', expected)

  if (sig !== expected) {
    console.error('[Instagram webhook] signature mismatch — sig:', sig.slice(0, 30), 'exp:', expected.slice(0, 30))
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const payload = JSON.parse(body)
  console.log('[Instagram webhook] received:', JSON.stringify(payload).slice(0, 1000))
  try {
    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message) continue
        const text = event.message.text ?? '[non-text message]'
        const senderId = event.sender.id
        const instagramIgId = entry.id
        const tsRaw = event.timestamp
        const ts = tsRaw > 1e12
          ? new Date(tsRaw).toISOString()
          : new Date(tsRaw * 1000).toISOString()
        const { data: contact, error: contactError } = await supabaseAdmin
          .from('contacts')
          .upsert({ instagram_handle: senderId }, { onConflict: 'instagram_handle' })
          .select()
          .single()
        if (contactError) continue
        if (!contact) continue
        let { data: convo } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('channel', 'instagram')
          .eq('status', 'open')
          .maybeSingle()
        if (!convo) {
          const { data: newConvo, error: convoError } = await supabaseAdmin
            .from('conversations')
            .insert({ contact_id: contact.id, channel: 'instagram', status: 'open' })
            .select()
            .single()
          if (convoError) continue
          convo = newConvo
        }
        if (!convo) continue
        const { error: msgError } = await supabaseAdmin.from('messages').insert({
          conversation_id: convo.id,
          channel: 'instagram',
          direction: 'inbound',
          body: text,
          timestamp: ts,
          read: false,
          raw_payload: { ...event, ig_page_id: instagramIgId },
        })
        if (msgError) continue
        await supabaseAdmin
          .from('conversations')
          .update({ last_message_at: ts })
          .eq('id', convo.id)
        console.log('[Instagram webhook] stored ok')
      }
    }
  } catch (err) {
    console.error('[Instagram webhook]', err)
  }
  return NextResponse.json({ ok: true })
}
