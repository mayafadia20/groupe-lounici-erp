-- Projets (ERP Groupe Lounici) — gestion de projet. À coller dans SQL Editor du projet « Lens Diagnostic », puis Run.
-- Réexécutable sans risque. S'appuie sur schema.sql (tables entreprises / membres et fonctions est_lounici(), mon_entreprise()).
-- Accès : comme Lens — Groupe Lounici (rôle lounici) voit tout ; les autres comptes voient les projets de leur entreprise.
-- entreprise_id vide = projet interne de Groupe Lounici (visible par le rôle lounici seulement).

create table if not exists public.pm_projets (
  id             uuid primary key default gen_random_uuid(),
  entreprise_id  uuid references public.entreprises(id) on delete cascade,
  nom            text not null,
  description    text,
  responsable    text,
  statut         text not null default 'planifie' check (statut in ('planifie', 'en_cours', 'en_pause', 'termine')),
  debut          date,
  fin            date,
  couleur        text,
  cree_par       uuid default auth.uid(),
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now()
);
create index if not exists pm_projets_entreprise_idx on public.pm_projets (entreprise_id, cree_le);

create table if not exists public.pm_taches (
  id             uuid primary key default gen_random_uuid(),
  projet_id      uuid not null references public.pm_projets(id) on delete cascade,
  entreprise_id  uuid references public.entreprises(id) on delete cascade,
  titre          text not null,
  description    text,
  statut         text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'en_revue', 'termine')),
  priorite       text not null default 'normale' check (priorite in ('basse', 'normale', 'haute', 'urgente')),
  responsable    text,
  debut          date,
  echeance       date,
  estimation_h   numeric,
  liste          jsonb not null default '[]'::jsonb,   -- sous-tâches : [{ "t": "texte", "ok": false }]
  ordre          double precision not null default 0,
  termine_le     timestamptz,
  cree_par       uuid default auth.uid(),
  cree_le        timestamptz not null default now(),
  maj_le         timestamptz not null default now()
);
create index if not exists pm_taches_projet_idx on public.pm_taches (projet_id, statut, ordre);
create index if not exists pm_taches_entreprise_idx on public.pm_taches (entreprise_id);

-- maj_le, et date de fin réelle d'une tâche (sert au suivi « terminées cette semaine »)
create or replace function public.pm_touch() returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  if tg_table_name = 'pm_taches' then
    if new.statut = 'termine' and (tg_op = 'INSERT' or old.statut is distinct from 'termine') then new.termine_le := now(); end if;
    if new.statut <> 'termine' then new.termine_le := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists pm_projets_touch on public.pm_projets;
create trigger pm_projets_touch before insert or update on public.pm_projets for each row execute function public.pm_touch();
drop trigger if exists pm_taches_touch on public.pm_taches;
create trigger pm_taches_touch before insert or update on public.pm_taches for each row execute function public.pm_touch();

-- une tâche appartient toujours à l'entreprise de son projet
create or replace function public.pm_tache_entreprise() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select entreprise_id into new.entreprise_id from public.pm_projets where id = new.projet_id;
  return new;
end $$;
drop trigger if exists pm_tache_entreprise on public.pm_taches;
create trigger pm_tache_entreprise before insert or update of projet_id on public.pm_taches for each row execute function public.pm_tache_entreprise();

alter table public.pm_projets enable row level security;
alter table public.pm_taches  enable row level security;

drop policy if exists "pm_projets_acces" on public.pm_projets;
create policy "pm_projets_acces" on public.pm_projets for all to authenticated
  using (public.est_lounici() or (entreprise_id is not null and entreprise_id = public.mon_entreprise()))
  with check (public.est_lounici() or (entreprise_id is not null and entreprise_id = public.mon_entreprise()));

drop policy if exists "pm_taches_acces" on public.pm_taches;
create policy "pm_taches_acces" on public.pm_taches for all to authenticated
  using (public.est_lounici() or (entreprise_id is not null and entreprise_id = public.mon_entreprise()))
  with check (public.est_lounici() or (entreprise_id is not null and entreprise_id = public.mon_entreprise()));

grant select, insert, update, delete on public.pm_projets, public.pm_taches to authenticated;
