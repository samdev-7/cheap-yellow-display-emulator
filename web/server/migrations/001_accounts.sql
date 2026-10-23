create table users (
    id uuid primary key default gen_random_uuid(),
    identity text not null unique,
    name text not null,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table sessions (
    token_hash text primary key,
    user_id uuid not null references users (id) on delete cascade,
    user_agent text,
    created_at timestamptz not null default now(),
    last_used_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

create table projects (
    id uuid primary key,
    user_id uuid not null references users (id) on delete cascade,
    name text not null,
    revision integer not null default 1,
    folders text[] not null default '{}',
    board jsonb not null default '{}',
    lease_holder text,
    lease_label text,
    lease_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);
create index projects_user on projects (user_id) where deleted_at is null;

create table project_files (
    project_id uuid not null references projects (id) on delete cascade,
    path text not null check (path like '/%'),
    data bytea not null,
    sha256 text not null,
    primary key (project_id, path)
);
