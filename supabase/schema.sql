-- ============================================================
-- Exemplary Voyages Unified Inbox — Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- CONTACTS
-- ────────────────────────────────────────────────────────────
create table contacts (
  id               uuid primary key default uuid_generate_v4(),
  name             text,
  phone            text unique,
  email            text unique,
  instagram_handle text unique,
  facebook_id      text unique,
  created_at       timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────
-- CONVERSATIONS
-- ────────────────────────────────────────────────────────────
create type channel_type as enum ('whatsapp', 'messenger', 'instagram', 'email');
create type conversation_status as enum ('open', 'pending', 'resolved');

create table conversations (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  channel         channel_type not null,
  status          conversation_status not null default 'open',
  assigned_agent  text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create index on conversations(contact_id);
create index on conversations(status);
create index on conversations(last_message_at desc);

-- ────────────────────────────────────────────────────────────
-- MESSAGES
-- ────────────────────────────────────────────────────────────
create type direction_type as enum ('inbound', 'outbound');

create table messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  channel         channel_type not null,
  direction       direction_type not null,
  body            text not null,
  timestamp       timestamptz not null,
  read            boolean not null default false,
  raw_payload     jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index on messages(conversation_id);
create index on messages(timestamp desc);

-- ────────────────────────────────────────────────────────────
-- REALTIME
-- Enable realtime for live inbox updates
-- ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table messages;

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

-- Allow authenticated users (EV agents) to read/write everything
create policy "agents can do everything on contacts"
  on contacts for all to authenticated using (true) with check (true);

create policy "agents can do everything on conversations"
  on conversations for all to authenticated using (true) with check (true);

create policy "agents can do everything on messages"
  on messages for all to authenticated using (true) with check (true);

-- Service role (webhooks) bypasses RLS automatically
