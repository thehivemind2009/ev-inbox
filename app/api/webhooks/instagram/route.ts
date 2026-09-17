import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.INSTAGRAM_APP_SECRET!)
    .update(body)
    .digest('hex')

  if (sig !== expected) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const payload = JSON.parse(body)

  try {
    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message?.text) continue

        const senderId       = event.sender.id
        const instagramIgId  = entry.id  // page's Instagram ID
        const text           = event.message.text
        const ts             = new Date(event.timestamp).toISOString()

        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .upsert({ instagram_handle: senderId }, { onConflict: 'instagram_handle' })
          .select()
          .single()

        if (!contact) continue

        let { data: convo } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('channel', 'instagram')
          .eq('status', 'open')
          .maybeSingle()

        if (!convo) {
          const { data: newConvo } = await supabaseAdmin
            .from('conversations')
            .insert({ contact_id: contact.id, channel: 'instagram', status: 'open' })
            .select()
            .single()
          convo = newConvo
        }

        if (!convo) continue

        await supabaseAdmin.from('messages').insert({
          conversation_id: convo.id,
          channel:         'instagram',
          direction:       'inbound',
          body:            text,
          timestamp:       ts,
          read:            false,
          raw_payload:     { ...event, ig_page_id: instagramIgId },
        })

        await supabaseAdmin
          .from('conversations')
          .update({ last_message_at: ts })
          .eq('id', convo.id)
      }
    }
  } catch (err) {
    console.error('[Instagram webhook]', err)
  }

  return NextResponse.json({ ok: true })
}
