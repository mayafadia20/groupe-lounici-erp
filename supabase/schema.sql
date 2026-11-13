-- Lens (Groupe Lounici) — schéma Supabase. À coller dans SQL Editor du projet « Lens Diagnostic » (Canada Central).
-- Réexécutable sans risque. Modèle : une entreprise cliente = un espace Lens (document JSON, le même que
-- l'export/import de lens.js) + ses enregistrements d'écran (vidéos dans le bucket « enregistrements »).
-- Accès : une personne appartient à une entreprise (table membres). Rôles : lounici (Groupe Lounici, voit tout),
-- admin (dirige l'espace de son entreprise), membre. Seuls les courriels de la liste acces_autorises peuvent
-- obtenir un compte ; le compte est alors rattaché automatiquement à son entreprise.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.entreprises (
  id       uuid primary key default gen_random_uuid(),
  nom      text not null,
  cree_le  timestamptz not null default now()
);

create table if not exists public.acces_autorises (
  email          text primary key check (email = lower(email)),
  entreprise_id  uuid references public.entreprises(id) on delete cascade,
  role           text not null default 'membre' check (role in ('lounici', 'admin', 'membre')),
  nom            text,
  ajoute_le      timestamptz not null default now(),
  ajoute_par     uuid default auth.uid()
);

create table if not exists public.membres (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  entreprise_id  uuid references public.entreprises(id) on delete set null,
  role           text not null default 'membre' check (role in ('lounici', 'admin', 'membre')),
  nom            text,
  email          text,
  cree_le        timestamptz not null default now()
);

create table if not exists public.espaces (
  entreprise_id  uuid primary key references public.entreprises(id) on delete cascade,
  data           jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);

create table if not exists public.enregistrements (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references public.entreprises(id) on delete cascade,
  processus      text,
  departement    text,
  qui            text,
  debut          timestamptz not null default now(),
  duree_s        integer,
  fichier        text,                       -- chemin dans le bucket « enregistrements » : <entreprise_id>/<nom>
  taille         bigint,
  type           text,
  statut         text not null default 'televerse' check (statut in ('televerse', 'analyse', 'cartographie', 'erreur')),
  transcription  text,
  epc            jsonb,
  cree_par       uuid default auth.uid(),
  cree_le        timestamptz not null default now()
);
create index if not exists enregistrements_entreprise_idx on public.enregistrements (entreprise_id, cree_le desc);
alter table public.enregistrements add column if not exists images integer;   -- nombre d'images capturées pendant l'enregistrement
alter table public.enregistrements add column if not exists diagnostic text;    -- « Diagnostic 1 », « Diagnostic 2 »… (numéro attribué par Lens)
alter table public.enregistrements add column if not exists description text;   -- description saisie par la personne

create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid not null references public.entreprises(id) on delete cascade,
  processus      text,
  diagnostic     text,
  nom            text not null,
  fichier        text not null,                 -- chemin dans le bucket « documents » : <entreprise_id>/documents/<nom>
  taille         bigint,
  type           text,
  texte          text,                          -- texte extrait (rempli plus tard par l'analyse)
  cree_par       uuid default auth.uid(),
  cree_le        timestamptz not null default now()
);
create index if not exists documents_entreprise_idx on public.documents (entreprise_id, cree_le desc);

-- ───────────────────────── fonctions d'accès ─────────────────────────
create or replace function public.mon_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.membres where user_id = auth.uid();
$$;
create or replace function public.mon_entreprise() returns uuid
language sql stable security definer set search_path = public as $$
  select entreprise_id from public.membres where user_id = auth.uid();
$$;
create or replace function public.est_lounici() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_role() = 'lounici', false);
$$;
create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.mon_role() in ('lounici', 'admin'), false);
$$;
revoke all on function public.mon_role(), public.mon_entreprise(), public.est_lounici(), public.est_admin() from public;
grant execute on function public.mon_role(), public.mon_entreprise(), public.est_lounici(), public.est_admin() to authenticated, service_role;

-- ───────────────────────── comptes : liste d'accès + rattachement automatique ─────────────────────────
create or replace function public.lens_inscription_reservee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or not exists (select 1 from public.acces_autorises a where a.email = lower(new.email)) then
    raise exception 'Inscription refusée : % n''est pas dans la liste des accès autorisés de Lens.', coalesce(new.email, '(sans courriel)');
  end if;
  return new;
end $$;
drop trigger if exists lens_inscription_reservee on auth.users;
create trigger lens_inscription_reservee before insert on auth.users
  for each row execute function public.lens_inscription_reservee();

create or replace function public.lens_creer_membre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.membres (user_id, entreprise_id, role, nom, email)
    select new.id, a.entreprise_id, a.role, coalesce(a.nom, new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), lower(new.email)
    from public.acces_autorises a where a.email = lower(new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists lens_creer_membre on auth.users;
create trigger lens_creer_membre after insert on auth.users
  for each row execute function public.lens_creer_membre();

-- ───────────────────────── invitation → création de l'entreprise par la personne invitée ─────────────────────────
alter table public.acces_autorises add column if not exists entreprise_nom text;   -- nom proposé par Groupe Lounici à l'invitation

create or replace function public.lens_creer_entreprise(p_email text, p_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.acces_autorises; eid uuid;
begin
  select * into a from public.acces_autorises where email = lower(trim(p_email));
  if not found then
    raise exception 'Cette adresse n''a pas été invitée par Groupe Lounici. Demandez votre accès à info@lounici.ca.';
  end if;
  if a.entreprise_id is not null then return a.entreprise_id; end if;        -- entreprise déjà créée
  insert into public.entreprises (nom) values (coalesce(nullif(trim(p_nom), ''), a.entreprise_nom, 'Entreprise')) returning id into eid;
  update public.acces_autorises set entreprise_id = eid, role = case when role = 'membre' then 'admin' else role end where email = a.email;
  return eid;
end $$;
revoke all on function public.lens_creer_entreprise(text, text) from public;
grant execute on function public.lens_creer_entreprise(text, text) to anon, authenticated;

-- ───────────────────────── données de départ ─────────────────────────
insert into public.entreprises (id, nom) values ('00000000-0000-4000-8000-000000000001', 'Groupe Lounici')
  on conflict (id) do nothing;
insert into public.acces_autorises (email, entreprise_id, role, nom) values
    ('maya@lounici.ca',        '00000000-0000-4000-8000-000000000001', 'lounici', 'Maya Lounici'),
    ('lounicimaya6@gmail.com', '00000000-0000-4000-8000-000000000001', 'lounici', 'Maya Lounici')
  on conflict (email) do update set role = excluded.role, entreprise_id = excluded.entreprise_id;

-- comptes créés avant l'exécution de ce script : rattachés s'ils sont dans la liste
insert into public.membres (user_id, entreprise_id, role, nom, email)
  select u.id, a.entreprise_id, a.role, coalesce(a.nom, split_part(u.email, '@', 1)), lower(u.email)
  from auth.users u join public.acces_autorises a on a.email = lower(u.email)
on conflict (user_id) do nothing;

-- ───────────────────────── règles d'accès (RLS) ─────────────────────────
alter table public.entreprises      enable row level security;
alter table public.acces_autorises  enable row level security;
alter table public.membres          enable row level security;
alter table public.espaces          enable row level security;
alter table public.enregistrements  enable row level security;
alter table public.documents        enable row level security;

drop policy if exists "entreprises_lecture"  on public.entreprises;
drop policy if exists "entreprises_gestion"  on public.entreprises;
create policy "entreprises_lecture" on public.entreprises for select to authenticated
  using (public.est_lounici() or id = public.mon_entreprise());
create policy "entreprises_gestion" on public.entreprises for all to authenticated
  using (public.est_lounici()) with check (public.est_lounici());

drop policy if exists "acces_lecture" on public.acces_autorises;
drop policy if exists "acces_gestion" on public.acces_autorises;
create policy "acces_lecture" on public.acces_autorises for select to authenticated
  using (public.est_lounici() or (public.est_admin() and entreprise_id = public.mon_entreprise()));
create policy "acces_gestion" on public.acces_autorises for all to authenticated
  using (public.est_lounici() or (public.est_admin() and entreprise_id = public.mon_entreprise() and role <> 'lounici'))
  with check (public.est_lounici() or (public.est_admin() and entreprise_id = public.mon_entreprise() and role <> 'lounici'));

drop policy if exists "membres_lecture" on public.membres;
drop policy if exists "membres_gestion" on public.membres;
drop policy if exists "membres_soi"     on public.membres;
create policy "membres_lecture" on public.membres for select to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise());
create policy "membres_gestion" on public.membres for all to authenticated
  using (public.est_lounici()) with check (public.est_lounici());
create policy "membres_soi" on public.membres for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and role = public.mon_role() and entreprise_id = public.mon_entreprise());

drop policy if exists "espaces_lecture"  on public.espaces;
drop policy if exists "espaces_ecriture" on public.espaces;
create policy "espaces_lecture" on public.espaces for select to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise());
create policy "espaces_ecriture" on public.espaces for all to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise())
  with check (public.est_lounici() or entreprise_id = public.mon_entreprise());

drop policy if exists "enr_lecture"  on public.enregistrements;
drop policy if exists "enr_ecriture" on public.enregistrements;
create policy "enr_lecture" on public.enregistrements for select to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise());
create policy "enr_ecriture" on public.enregistrements for all to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise())
  with check (public.est_lounici() or entreprise_id = public.mon_entreprise());

drop policy if exists "doc_lecture"  on public.documents;
drop policy if exists "doc_ecriture" on public.documents;
create policy "doc_lecture" on public.documents for select to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise());
create policy "doc_ecriture" on public.documents for all to authenticated
  using (public.est_lounici() or entreprise_id = public.mon_entreprise())
  with check (public.est_lounici() or entreprise_id = public.mon_entreprise());

-- updated_at / updated_by des espaces
create or replace function public.espaces_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists espaces_touch on public.espaces;
create trigger espaces_touch before insert or update on public.espaces for each row execute function public.espaces_touch();

-- ───────────────────────── vidéos : bucket privé « enregistrements » ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
  values ('enregistrements', 'enregistrements', false, 52428800)     -- 50 Mo par fichier (limite du forfait gratuit)
  on conflict (id) do update set public = false;

-- documents de contexte (PDF, Excel, Word, Markdown…) : bucket privé « documents »
insert into storage.buckets (id, name, public, file_size_limit)
  values ('documents', 'documents', false, 52428800)
  on conflict (id) do update set public = false;
drop policy if exists "docs_lecture"     on storage.objects;
drop policy if exists "docs_ajout"       on storage.objects;
drop policy if exists "docs_suppression" on storage.objects;
create policy "docs_lecture" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));
create policy "docs_ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));
create policy "docs_suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));

drop policy if exists "videos_lecture"     on storage.objects;
drop policy if exists "videos_ajout"       on storage.objects;
drop policy if exists "videos_suppression" on storage.objects;
create policy "videos_lecture" on storage.objects for select to authenticated
  using (bucket_id = 'enregistrements' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));
create policy "videos_ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'enregistrements' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));
create policy "videos_suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'enregistrements' and (public.est_lounici() or (storage.foldername(name))[1] = public.mon_entreprise()::text));
