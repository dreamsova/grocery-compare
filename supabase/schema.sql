-- Grocery Compare Supabase/Postgres schema
-- Run this in Supabase SQL Editor for the production persistence target.

create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  display_name text,
  ic_plus boolean default false,
  wm_plus boolean default false,
  created_at timestamptz default now()
);

create table if not exists refresh_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists products (
  id text primary key,
  name text not null,
  image_url text,
  walmart_url text,
  instacart_url text,
  created_by text not null references users(id),
  brand text,
  size text,
  barcode text,
  nutrition_json jsonb,
  external_sources_json jsonb,
  enriched_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists price_snapshots (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  store text not null,
  price numeric(10, 2) not null,
  in_stock boolean default true,
  scraped_at timestamptz default now(),
  source_label text,
  source_kind text,
  confidence numeric(4, 2),
  evidence_note text,
  submitted_by text references users(id),
  submitted_at timestamptz
);

create index if not exists idx_price_product_store_time
  on price_snapshots(product_id, store, scraped_at desc);

create table if not exists shopping_lists (
  id text primary key,
  name text not null,
  owner_id text not null references users(id) on delete cascade,
  share_token text unique,
  created_at timestamptz default now()
);

create table if not exists list_collaborators (
  list_id text not null references shopping_lists(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text default 'editor',
  joined_at timestamptz default now(),
  primary key (list_id, user_id)
);

create table if not exists list_items (
  id text primary key,
  list_id text not null references shopping_lists(id) on delete cascade,
  product_id text not null references products(id),
  quantity integer default 1,
  checked boolean default false,
  added_by text not null references users(id),
  store_choice text,
  notes text,
  position integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists receipt_images (
  id text primary key,
  product_id text not null references products(id) on delete cascade,
  price_snapshot_id text references price_snapshots(id) on delete set null,
  store text,
  image_data text,
  storage_path text,
  mime_type text not null,
  file_name text,
  file_size integer,
  note text,
  uploaded_by text not null references users(id),
  created_at timestamptz default now()
);

create index if not exists idx_receipt_images_product_time
  on receipt_images(product_id, created_at desc);

-- Recommended production storage:
-- create a private Supabase Storage bucket named "receipts".
-- Store receipt files there and keep storage_path in receipt_images.
