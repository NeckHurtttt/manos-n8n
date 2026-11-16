-- Manos que hablan: pegar en Supabase → SQL Editor → Run.
-- Antes de correrlo, CAMBIA la clave del equipo de la línea marcada.

create table if not exists senas (
  nombre text primary key,
  orden int not null default 0,
  creado timestamptz not null default now()
);
create table if not exists muestras (
  id bigint generated always as identity primary key,
  sena text not null,
  x text not null,                 -- 1320 floats en base64
  creado timestamptz not null default now()
);
create index if not exists muestras_sena on muestras (sena);
create table if not exists videos (
  sena text primary key,
  datos text not null,             -- video webm como data URL
  creado timestamptz not null default now()
);
create table if not exists modelo (
  id int primary key,
  datos jsonb not null,
  creado timestamptz not null default now()
);

-- Clave del equipo: nadie puede leer esta tabla desde la app.
create table if not exists clave_equipo (clave text not null);
alter table clave_equipo enable row level security;
delete from clave_equipo;
insert into clave_equipo values ('CAMBIA-ESTA-CLAVE');   -- ← cámbiala

create or replace function es_equipo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clave_equipo
    where clave = coalesce(current_setting('request.headers', true)::json ->> 'x-equipo', '')
  );
$$;
grant execute on function es_equipo() to anon, authenticated;

-- Todos leen; solo quien manda la clave correcta escribe o borra.
do $$
declare t text;
begin
  foreach t in array array['senas','muestras','videos','modelo'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists leer on %I', t);
    execute format('drop policy if exists escribir on %I', t);
    execute format('drop policy if exists cambiar on %I', t);
    execute format('drop policy if exists borrar on %I', t);
    execute format('create policy leer on %I for select using (true)', t);
    execute format('create policy escribir on %I for insert with check (es_equipo())', t);
    execute format('create policy cambiar on %I for update using (es_equipo()) with check (es_equipo())', t);
    execute format('create policy borrar on %I for delete using (es_equipo())', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;
grant usage on sequence muestras_id_seq to anon, authenticated;
