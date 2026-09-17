import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode      = searchParams.get('hub.mode')
  const token     = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.MESSENGER_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('x-hub-signature-256') ?? ''
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.MESSENGER_APP_SECRET!)
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

        const senderId = event.sender.id
        const text     = event.message.text
        const ts       = new Date(event.timestamp).toISOString()

        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .upsert({ facebook_id: senderId }, { onConflict: 'facebook_id' })
          .select()
          .single()

        if (!contact) continue

        let { data: convo } = await supabaseAdmin
          .from('conversations')
          .select('id')
          .eq('contact_id', contact.id)
          .eq('channel', 'messenger')
          .eq('status', 'open')
          .maybeSingle()

        if (!convo) {
          const { data: newConvo } = await supabaseAdmin
            .from('conversations')
            .insert({ contact_id: contact.id, channel: 'messenger', status: 'open' })
            .select()
            .single()
          convo = newConvo
        }

        if (!convo) continue

        await supabaseAdmin.from('messages').insert({
          conversation_id: convo.id,
          channel:         'messenger',
          direction:       'inbound',
          body:            text,
          timestamp:       ts,
          read:            false,
          raw_payload:     event,
        })

        await supabaseAdmin
          .from('conversations')
          .update({ last_message_at: ts })
          .eq('id', convo.id)
      }
    }
  } catch (err) {
    console.error('[Messenger webhook]', err)
  }

  return NextResponse.json({ ok: true })
}
