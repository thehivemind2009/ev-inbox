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
  const body = await req.text()
  const sig = req.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!)
    .update(body)
    .digest('hex')
  if (sig !== expected) {
    console.error('[Instagram webhook] signature mismatch')
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const payload = JSON.parse(body)
  console.log('[Instagram webhook] received:', JSON.stringify(payload).slice(0, 1000))
  try {
    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        console.log('[Instagram webhook] event:', JSON.stringify(event).slice(0, 500))
        if (!event.message) {
          console.log('[Instagram webhook] skipping non-message event')
          continue
        }
        const text = event.message.text ?? '[non-text message]'
        const senderId = event.sender.id
        const instagramIgId = entry.id
        // Fix timestamp: Meta sends Unix seconds; multiply by 1000 for JS Date
        const tsRaw = event.timestamp
        const ts = tsRaw > 1e12
          ? new Date(tsRaw).toISOString()
          : new Date(tsRaw * 1000).toISOString()
        console.log('[Instagram webhook] processing from', senderId, 'text:', text.slice(0, 100))
        const { data: contact, error: contactError } = await supabaseAdmin
          .from('contacts')
          .upsert({ instagram_handle: senderId }, { onConflict: 'instagram_handle' })
          .select()
          .single()
        if (contactError) {
          console.error('[Instagram webhook] contact error:', contactError)
          continue
        }
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
          if (convoError) {
            console.error('[Instagram webhook] convo error:', convoError)
            continue
          }
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
        if (msgError) {
          console.error('[Instagram webhook] message error:', msgError)
          continue
        }
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
