-- CRM (ERP Groupe Lounici) — suivi des clients et prospects contactés. À coller dans SQL Editor du projet « Lens Diagnostic », puis Run.
-- Réexécutable sans risque. S'appuie sur schema.sql (fonction est_lounici()).
-- Accès : réservé à Groupe Lounici (rôle lounici). Les comptes clients de Lens n'y ont pas accès.

create table if not exists public.crm_comptes (
  id                 uuid primary key default gen_random_uuid(),
  nom                text not null,
  secteur            text,
  ville              text,
  site_web           text,
  telephone          text,
  etape              text not null default 'prospect' check (etape in ('prospect', 'contacte', 'rencontre', 'proposition', 'gagne', 'perdu')),
  valeur             numeric,                 -- valeur estimée du mandat ($)
  source             text,                    -- recommandation, LinkedIn, événement, site web…
  responsable        text,
  notes              text,
  prochaine_relance  date,
  relance_note       text,
  dernier_contact    timestamptz,             -- tenu à jour par les activités
  cree_par           uuid default auth.uid(),
  cree_le            timestamptz not null default now(),
  maj_le             timestamptz not null default now()
);
create index if not exists crm_comptes_etape_idx on public.crm_comptes (etape);
create index if not exists crm_comptes_relance_idx on public.crm_comptes (prochaine_relance);

create table if not exists public.crm_contacts (
  id          uuid primary key default gen_random_uuid(),
  compte_id   uuid not null references public.crm_comptes(id) on delete cascade,
  nom         text not null,
  poste       text,
  courriel    text,
  telephone   text,
  linkedin    text,
  notes       text,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);
create index if not exists crm_contacts_compte_idx on public.crm_contacts (compte_id);

create table if not exists public.crm_activites (
  id          uuid primary key default gen_random_uuid(),
  compte_id   uuid not null references public.crm_comptes(id) on delete cascade,
  contact_id  uuid references public.crm_contacts(id) on delete set null,
  type        text not null default 'appel' check (type in ('appel', 'courriel', 'rencontre', 'linkedin', 'message', 'note')),
  sens        text not null default 'sortant' check (sens in ('sortant', 'entrant')),
  quand       timestamptz not null default now(),
  sujet       text,
  notes       text,
  resultat    text,                            -- ex. « intéressé », « pas de réponse », « rappeler en janvier »
  cree_par    uuid default auth.uid(),
  cree_le     timestamptz not null default now()
);
create index if not exists crm_activites_compte_idx on public.crm_activites (compte_id, quand desc);
create index if not exists crm_activites_quand_idx on public.crm_activites (quand desc);

-- maj_le automatique
create or replace function public.crm_touch() returns trigger language plpgsql as $$
begin new.maj_le := now(); return new; end $$;
drop trigger if exists crm_comptes_touch on public.crm_comptes;
create trigger crm_comptes_touch before update on public.crm_comptes for each row execute function public.crm_touch();
drop trigger if exists crm_contacts_touch on public.crm_contacts;
create trigger crm_contacts_touch before update on public.crm_contacts for each row execute function public.crm_touch();

-- « dernier contact » du compte = activité la plus récente (hors simples notes)
create or replace function public.crm_dernier_contact() returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.compte_id, old.compte_id);
begin
  update public.crm_comptes set dernier_contact = (select max(quand) from public.crm_activites where compte_id = cid and type <> 'note') where id = cid;
  return null;
end $$;
drop trigger if exists crm_dernier_contact on public.crm_activites;
create trigger crm_dernier_contact after insert or update or delete on public.crm_activites for each row execute function public.crm_dernier_contact();

alter table public.crm_comptes   enable row level security;
alter table public.crm_contacts  enable row level security;
alter table public.crm_activites enable row level security;

drop policy if exists "crm_comptes_lounici" on public.crm_comptes;
create policy "crm_comptes_lounici" on public.crm_comptes for all to authenticated using (public.est_lounici()) with check (public.est_lounici());
drop policy if exists "crm_contacts_lounici" on public.crm_contacts;
create policy "crm_contacts_lounici" on public.crm_contacts for all to authenticated using (public.est_lounici()) with check (public.est_lounici());
drop policy if exists "crm_activites_lounici" on public.crm_activites;
create policy "crm_activites_lounici" on public.crm_activites for all to authenticated using (public.est_lounici()) with check (public.est_lounici());

grant select, insert, update, delete on public.crm_comptes, public.crm_contacts, public.crm_activites to authenticated;
