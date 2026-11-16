-- Puente n8n: salas (una conversación) y mensajes de ida y vuelta.
-- Correr en Supabase → SQL Editor, además de supabase.sql.
create table if not exists salas (
  codigo   text primary key,             -- 6 letras que la página inventa
  chat_id  bigint,                       -- chat de Telegram de la persona oyente
  nombre   text,                         -- nombre en Telegram
  creado   timestamptz default now()
);
create table if not exists mensajes (
  id      bigint generated always as identity primary key,
  sala    text not null references salas(codigo) on delete cascade,
  dir     text not null check (dir in ('ida','vuelta','aviso')),
  texto   text not null,
  glosas  text[],
  creado  timestamptz default now()
);
create index if not exists mensajes_sala on mensajes (sala, id);

alter table salas enable row level security;
alter table mensajes enable row level security;
-- La página solo LEE (con la clave pública). Escribe únicamente n8n con la service_role.
drop policy if exists leer_salas on salas;
create policy leer_salas on salas for select using (true);
drop policy if exists leer_mensajes on mensajes;
create policy leer_mensajes on mensajes for select using (true);
