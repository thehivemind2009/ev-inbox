export type Channel = 'whatsapp' | 'messenger' | 'instagram' | 'email'
export type Direction = 'inbound' | 'outbound'
export type ConversationStatus = 'open' | 'pending' | 'resolved'

export interface Contact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  instagram_handle: string | null
  facebook_id: string | null
  created_at: string
}

export interface Conversation {
  id: string
  contact_id: string
  channel: Channel
  status: ConversationStatus
  assigned_agent: string | null
  last_message_at: string | null
  created_at: string
  contact?: Contact
  messages?: Message[]
}

export interface Message {
  id: string
  conversation_id: string
  channel: Channel
  direction: Direction
  body: string
  timestamp: string
  read: boolean
  raw_payload: Record<string, unknown>
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      contacts: {
        Row: Contact
        Insert: Omit<Contact, 'id' | 'created_at'>
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
      }
      conversations: {
        Row: Conversation
        Insert: Omit<Conversation, 'id' | 'created_at'>
        Update: Partial<Omit<Conversation, 'id' | 'created_at'>>
      }
      messages: {
        Row: Message
        Insert: Omit<Message, 'id' | 'created_at'>
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
      }
    }
  }
}
