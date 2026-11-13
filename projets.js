// Projets — outil de gestion de projet de l'ERP Groupe Lounici (aucune dépendance hormis le client Supabase de lens-cloud.js).
// Données : tables pm_projets / pm_taches (supabase/projets.sql), filtrées par entreprise et protégées par RLS.
// Sans configuration Supabase : mode local, données dans ce navigateur (localStorage « erp.projets »).
(function () {
  "use strict";

  // ───────────────────────── constantes ─────────────────────────
  const STATUTS = [["a_faire", "À faire"], ["en_cours", "En cours"], ["en_revue", "En revue"], ["termine", "Terminé"]];
  const PSTATUTS = [["planifie", "Planifié"], ["en_cours", "En cours"], ["en_pause", "En pause"], ["termine", "Terminé"]];
  const PRIOS = [["urgente", "Urgente"], ["haute", "Haute"], ["normale", "Normale"], ["basse", "Basse"]];
  const COULEURS = ["#0a0a0a", "#5b5b62", "#2f6f8f", "#2f7d4f", "#c98a14", "#c4372b", "#7a4fb0", "#b0597a"];
  const LBL = (list, k) => (list.find((x) => x[0] === k) || [k, k])[1];
  const PRIO_RANK = { urgente: 0, haute: 1, normale: 2, basse: 3 };
  const ST_RANK = { a_faire: 0, en_cours: 1, en_revue: 2, termine: 3 };
  const LOCAL_KEY = "erp.projets", ENT_KEY = "erp.projets.ent", TAB_KEY = "erp.projets.onglet";
  const DAY = 86400000;

  // ───────────────────────── outils ─────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => iso(new Date());
  const parse = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY + 3600000));
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const fmtD = (s, withYear) => { const d = parse(s); if (!d) return ""; const o = { day: "numeric", month: "short" }; if (withYear || d.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return d.toLocaleDateString("fr-CA", o); };
  const initials = (n) => { const p = String(n || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); };
  const ICON_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON_LIST = '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6l.01 0M4 12l.01 0M4 18l.01 0"/></svg>';

  function toast(msg, ok) {
    const t = document.createElement("div"); t.className = "toast" + (ok === false ? " err" : ""); t.textContent = msg;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), ok === false ? 5200 : 2600);
  }
  let pending = 0;
  function sync(delta) {
    pending += delta; const el = $("#sync");
    el.textContent = pending > 0 ? "Enregistrement…" : S.cloud ? "Enregistré en ligne" : "Enregistré dans ce navigateur";
  }

  // ───────────────────────── état ─────────────────────────
  const S = {
    cloud: !!(window.LensCloud && LensCloud.enabled), me: null, ent: null, ents: [], projets: [], taches: [], people: [],
    route: { v: "apercu" }, q: "", fResp: "", fPrio: "", fOpen: "", sort: { k: "echeance", asc: true }, loadedAt: 0,
  };

  // ───────────────────────── stockage ─────────────────────────
  const tableManquante = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|Could not find the table/i.test(e.message || ""));
  const Local = {
    read() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || { projets: [], taches: [] }; } catch (_) { return { projets: [], taches: [] }; } },
    write(d) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch (_) { toast("Stockage du navigateur indisponible", false); } },
  };
  const Store = {
    async c() { return LensCloud.client(); },
    scope(q, col) { return S.ent ? q.eq(col || "entreprise_id", S.ent) : q.is(col || "entreprise_id", null); },
    async load() {
      if (!S.cloud) { const d = Local.read(); S.projets = d.projets; S.taches = d.taches; return; }
      const c = await this.c();
      const [p, t] = await Promise.all([
        this.scope(c.from("pm_projets").select("*")).order("cree_le"),
        this.scope(c.from("pm_taches").select("*")).order("ordre"),
      ]);
      if (p.error) throw p.error; if (t.error) throw t.error;
      S.projets = p.data || []; S.taches = t.data || [];
    },
    async insert(table, row) {
      if (!S.cloud) { const d = Local.read(); const now = new Date().toISOString(); const r = Object.assign({ id: uid(), cree_le: now, maj_le: now }, row); d[table === "pm_projets" ? "projets" : "taches"].push(r); Local.write(d); return r; }
      const c = await this.c(); const { data, error } = await c.from(table).insert(Object.assign({ entreprise_id: S.ent }, row)).select().single();
      if (error) throw error; return data;
    },
    async update(table, id, patch) {
      if (!S.cloud) { const d = Local.read(); const arr = d[table === "pm_projets" ? "projets" : "taches"]; const r = arr.find((x) => x.id === id); if (r) Object.assign(r, patch, { maj_le: new Date().toISOString() }); Local.write(d); return r; }
      const c = await this.c(); const { data, error } = await c.from(table).update(patch).eq("id", id).select().single();
      if (error) throw error; return data;
    },
    async remove(table, id) {
      if (!S.cloud) { const d = Local.read(); if (table === "pm_projets") { d.projets = d.projets.filter((x) => x.id !== id); d.taches = d.taches.filter((x) => x.projet_id !== id); } else d.taches = d.taches.filter((x) => x.id !== id); Local.write(d); return; }
      const c = await this.c(); const { error } = await c.from(table).delete().eq("id", id); if (error) throw error;
    },
    async people() {
      if (!S.cloud) return [];
      const c = await this.c(); let q = c.from("membres").select("nom, email");
      q = S.ent ? q.eq("entreprise_id", S.ent) : q.eq("role", "lounici");
      const { data } = await q; return data || [];
    },
  };

  // écriture optimiste : l'interface change tout de suite, la base suit ; en cas d'échec on recharge
  async function persist(fn, quoi) {
    sync(1);
    try { return await fn(); }
    catch (e) { console.error(e); toast((quoi || "Enregistrement impossible") + " : " + (e.message || e), false); await reload(); }
    finally { sync(-1); }
  }

  // ───────────────────────── calculs ─────────────────────────
  const proj = (id) => S.projets.find((p) => p.id === id);
  const tachesDe = (pid) => S.taches.filter((t) => t.projet_id === pid);
  const progres = (pid) => { const l = tachesDe(pid); return l.length ? Math.round((100 * l.filter((t) => t.statut === "termine").length) / l.length) : 0; };
  const enRetard = (t) => t.statut !== "termine" && t.echeance && t.echeance < today();
  const bientot = (t) => t.statut !== "termine" && t.echeance && !enRetard(t) && diffDays(today(), t.echeance) <= 2;
  const moi = (t) => { if (!t.responsable) return false; const r = t.responsable.trim().toLowerCase(); return !!S.me && [S.me.nom, S.me.email].some((x) => x && x.trim().toLowerCase() === r); };
  const cherche = (t) => !S.q || (t.titre + " " + (t.description || "") + " " + (t.responsable || "")).toLowerCase().includes(S.q);

  function dueHtml(t) {
    if (!t.echeance) return "";
    const cls = enRetard(t) ? " late" : bientot(t) ? " soon" : "";
    const n = diffDays(today(), t.echeance);
    const txt = t.statut !== "termine" && n === 0 ? "Aujourd’hui" : t.statut !== "termine" && n === 1 ? "Demain" : fmtD(t.echeance);
    return '<span class="due' + cls + '">' + esc(txt) + "</span>";
  }
  const avatar = (n) => n ? '<span class="avatar" title="' + esc(n) + '">' + esc(initials(n)) + "</span>" : '<span class="avatar none" title="Non assignée">–</span>';

  // ───────────────────────── barre latérale ─────────────────────────
  function renderSide() {
    const r = S.route;
    $$(".side-nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.v));
    $("#proj-list").innerHTML = S.projets.length
      ? S.projets.slice().sort((a, b) => (a.statut === "termine") - (b.statut === "termine") || a.nom.localeCompare(b.nom, "fr"))
          .map((p) => '<li><a href="#projet/' + p.id + '" class="' + (r.v === "projet" && r.id === p.id ? "on" : "") + '"><i class="dot" style="--c:' + esc(!p.couleur || p.couleur === "#0a0a0a" ? "#fff" : p.couleur) + '"></i><span class="nm">' + esc(p.nom) + '</span><span class="pc">' + progres(p.id) + "%</span></a></li>").join("")
      : '<li class="empty">Aucun projet pour l’instant.</li>';
    const mine = S.taches.filter((t) => moi(t) && t.statut !== "termine").length;
    const c = $("#mine-count"); c.hidden = !mine; c.textContent = mine;
  }

  // ───────────────────────── routage ─────────────────────────
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    const m = /^projet\/([^/]+)(?:\/(\w+))?/.exec(h);
    if (m && proj(m[1])) {
      let tab = m[2]; if (!tab) { try { tab = localStorage.getItem(TAB_KEY); } catch (_) {} }
      S.route = { v: "projet", id: m[1], tab: ["tableau", "liste", "echeancier"].includes(tab) ? tab : "tableau" };
    } else S.route = { v: h === "mes-taches" ? "mes-taches" : "apercu" };
    $("#app").classList.remove("menu");
    render();
  }
  function render() {
    renderSide();
    const v = S.route.v;
    $("#search").placeholder = v === "projet" ? "Rechercher dans ce projet…" : "Rechercher une tâche…";
    if (S.q && v !== "projet") return renderSearch();
    if (v === "projet") return renderProjet();
    if (v === "mes-taches") return renderMine();
    renderApercu();
  }

  // ───────────────────────── vue d'ensemble ─────────────────────────
  function renderApercu() {
    const ouvertes = S.taches.filter((t) => t.statut !== "termine");
    const retard = ouvertes.filter(enRetard);
    const semaine = Date.now() - 7 * DAY;
    const finies = S.taches.filter((t) => t.statut === "termine" && t.termine_le && new Date(t.termine_le).getTime() >= semaine).length;
    const actifs = S.projets.filter((p) => p.statut === "en_cours").length;
    const aVenir = ouvertes.filter((t) => t.echeance && !enRetard(t) && diffDays(today(), t.echeance) <= 14).sort((a, b) => a.echeance.localeCompare(b.echeance));
    const entNom = S.ent ? ((S.ents.find((e) => e.id === S.ent) || {}).nom || (S.me && S.me.entreprises && S.me.entreprises.nom) || "") : S.cloud ? "Groupe Lounici · projets internes" : "";

    const list = (arr) => arr.length ? '<div class="dl">' + arr.slice(0, 8).map((t) => '<button type="button" data-task="' + t.id + '">' + avatar(t.responsable) + '<span class="t">' + esc(t.titre) + "<small>" + esc((proj(t.projet_id) || {}).nom || "") + "</small></span>" + dueHtml(t) + "</button>").join("") + "</div>" : "";

    $("#view").innerHTML =
      '<div class="page-head"><div><h1 class="title">Vue d’ensemble</h1><p class="sub">' + esc(entNom || "Tous vos projets") + '</p></div><div class="actions"><button class="btn black" type="button" data-act="new-proj"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nouveau projet</button></div></div>' +
      '<div class="kpis"><div class="kpi dark"><b>' + actifs + '</b><span>Projets en cours</span></div><div class="kpi"><b>' + ouvertes.length + '</b><span>Tâches ouvertes</span></div><div class="kpi' + (retard.length ? " alert" : "") + '"><b>' + retard.length + '</b><span>Tâches en retard</span></div><div class="kpi"><b>' + finies + "</b><span>Terminées ces 7 derniers jours</span></div></div>" +
      '<div class="grid-2"><section class="card"><h2>Projets <small>' + S.projets.length + "</small></h2>" +
        (S.projets.length ? '<div class="pcards">' + S.projets.map((p) => { const l = tachesDe(p.id), pc = progres(p.id); return '<a class="pcard" href="#projet/' + p.id + '" style="--c:' + esc(p.couleur || "#000") + '"><span class="nm"><i></i>' + esc(p.nom) + '</span><span class="meta"><span class="pill s-' + p.statut + '">' + LBL(PSTATUTS, p.statut) + "</span><span>" + (p.fin ? "Fin " + esc(fmtD(p.fin)) : "") + '</span></span><span class="bar"><i style="--p:' + pc + '%"></i></span><span class="meta"><span>' + l.filter((t) => t.statut === "termine").length + " / " + l.length + " tâches</span><span>" + pc + "%</span></span></a>"; }).join("") + "</div>"
          : '<div class="empty-state">Créez votre premier projet pour commencer.<br><button class="btn black" type="button" data-act="new-proj">Nouveau projet</button></div>') +
      "</section><div style=\"display:grid;gap:14px\">" +
        (retard.length ? '<section class="card"><h2>En retard <small>' + retard.length + "</small></h2>" + list(retard.sort((a, b) => a.echeance.localeCompare(b.echeance))) + "</section>" : "") +
        '<section class="card"><h2>Échéances des 14 prochains jours <small>' + aVenir.length + "</small></h2>" + (list(aVenir) || '<div class="empty-state">Rien d’urgent.</div>') + "</section>" +
      "</div></div>" +
      (S.projets.some((p) => p.debut || p.fin || tachesDe(p.id).some((t) => t.debut || t.echeance)) ? '<section class="card" style="margin-top:14px"><h2>Échéancier des projets</h2><div class="gantt" id="gantt"></div></section>' : "");
    const g = $("#gantt"); if (g) gantt(g, S.projets.map((p) => { const r = projRange(p); return { id: p.id, kind: "proj", label: p.nom, start: r[0], end: r[1], color: p.couleur }; }));
  }
  function projRange(p) {
    const ds = tachesDe(p.id).flatMap((t) => [t.debut, t.echeance]).filter(Boolean).sort();
    return [p.debut || ds[0] || p.fin || null, p.fin || ds[ds.length - 1] || p.debut || null];
  }

  // ───────────────────────── mes tâches ─────────────────────────
  function renderMine() {
    const mes = S.taches.filter((t) => moi(t) && t.statut !== "termine");
    const t0 = today(), groupes = [["En retard", (t) => enRetard(t)], ["Aujourd’hui", (t) => t.echeance === t0], ["Cette semaine", (t) => t.echeance > t0 && diffDays(t0, t.echeance) <= 7], ["Plus tard", (t) => t.echeance && diffDays(t0, t.echeance) > 7], ["Sans échéance", (t) => !t.echeance]];
    const nom = S.me ? S.me.nom || S.me.email : "";
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Mes tâches</h1><p class="sub">Tâches ouvertes dont le responsable est « ' + esc(nom) + " »</p></div></div>" +
      (mes.length ? '<div class="table-wrap"><table class="tasks"><thead><tr><th style="width:44px"></th><th>Tâche</th><th>Projet</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr></thead><tbody>' +
        groupes.map(([g, f]) => { const l = mes.filter(f).sort(triEcheance); return l.length ? '<tr class="group-row"><td colspan="6">' + g + " · " + l.length + "</td></tr>" + l.map((t) => ligne(t, true)).join("") : ""; }).join("") + "</tbody></table></div>"
        : '<div class="card empty-state">Aucune tâche ouverte ne vous est assignée.<br><small>Une tâche vous est assignée quand son responsable porte votre nom ou votre courriel.</small></div>');
  }
  const triEcheance = (a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999") || PRIO_RANK[a.priorite] - PRIO_RANK[b.priorite];
  function ligne(t, avecProjet) {
    const n = (t.liste || []).length, ok = (t.liste || []).filter((x) => x.ok).length;
    return '<tr data-task="' + t.id + '"><td><button type="button" class="check' + (t.statut === "termine" ? " on" : "") + '" data-toggle="' + t.id + '" aria-label="Terminer">' + (t.statut === "termine" ? ICON_CHECK : "") + "</button></td>" +
      '<td class="t">' + esc(t.titre) + (n ? "<small>" + ok + " / " + n + " sous-tâches</small>" : "") + "</td>" +
      (avecProjet ? "<td>" + esc((proj(t.projet_id) || {}).nom || "") + "</td>" : "") +
      '<td><span class="pill s-' + t.statut + '">' + LBL(STATUTS, t.statut) + "</span></td>" +
      '<td><span class="prio p-' + t.priorite + '">' + LBL(PRIOS, t.priorite) + "</span></td>" +
      (avecProjet ? "" : '<td><span style="display:inline-flex;gap:8px;align-items:center">' + avatar(t.responsable) + esc(t.responsable || "") + "</span></td>") +
      "<td>" + (dueHtml(t) || '<span class="due">—</span>') + "</td></tr>";
  }

  // ───────────────────────── recherche ─────────────────────────
  function renderSearch() {
    const l = S.taches.filter(cherche).sort((a, b) => ST_RANK[a.statut] - ST_RANK[b.statut] || triEcheance(a, b));
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Recherche</h1><p class="sub">' + l.length + " tâche" + (l.length > 1 ? "s" : "") + " pour « " + esc(S.q) + " »</p></div></div>" +
      (l.length ? '<div class="table-wrap"><table class="tasks"><thead><tr><th style="width:44px"></th><th>Tâche</th><th>Projet</th><th>Statut</th><th>Priorité</th><th>Échéance</th></tr></thead><tbody>' + l.map((t) => ligne(t, true)).join("") + "</tbody></table></div>" : '<div class="card empty-state">Aucun résultat.</div>');
  }

  // ───────────────────────── projet ─────────────────────────
  function filtres(l) {
    return l.filter((t) => cherche(t) && (!S.fResp || (S.fResp === "-" ? !t.responsable : t.responsable === S.fResp)) && (!S.fPrio || t.priorite === S.fPrio) && (!S.fOpen || t.statut !== "termine"));
  }
  function renderProjet() {
    const p = proj(S.route.id), tab = S.route.tab, all = tachesDe(p.id), pc = progres(p.id);
    const resp = [...new Set(all.map((t) => t.responsable).filter(Boolean))].sort();
    const r = projRange(p);
    $("#view").innerHTML =
      '<div class="proj-head" style="--c:' + esc(p.couleur || "#000") + '"><div class="row"><div class="ttl"><i></i><h1 class="title">' + esc(p.nom) + '</h1><span class="pill s-' + p.statut + '">' + LBL(PSTATUTS, p.statut) + "</span></div>" +
        '<div class="page-head" style="margin:0"><div class="actions"><button class="btn" type="button" data-act="edit-proj"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>Modifier</button><button class="btn danger" type="button" data-act="del-proj">Supprimer</button></div></div></div>' +
        '<div class="proj-meta">' + (p.responsable ? "<span>Responsable <b>" + esc(p.responsable) + "</b></span>" : "") + (r[0] || r[1] ? "<span>" + esc(r[0] ? fmtD(r[0], true) : "?") + " → " + esc(r[1] ? fmtD(r[1], true) : "?") + "</span>" : "") +
          '<span style="display:inline-flex;gap:10px;align-items:center"><span class="bar"><i style="--p:' + pc + '%"></i></span><b>' + pc + "%</b> · " + all.filter((t) => t.statut === "termine").length + " / " + all.length + " tâches</span></div>" +
        (p.description ? '<p class="proj-desc">' + esc(p.description) + "</p>" : "") +
        '<div class="row"><div class="tabs" role="tablist">' + [["tableau", "Tableau"], ["liste", "Liste"], ["echeancier", "Échéancier"]].map(([k, l]) => '<button type="button" role="tab" data-tab="' + k + '" class="' + (k === tab ? "on" : "") + '">' + l + "</button>").join("") + "</div>" +
        '<div class="filters"><select id="f-resp" aria-label="Responsable"><option value="">Tous les responsables</option><option value="-"' + (S.fResp === "-" ? " selected" : "") + ">Non assignées</option>" + resp.map((x) => "<option" + (x === S.fResp ? " selected" : "") + ">" + esc(x) + "</option>").join("") + "</select>" +
          '<select id="f-prio" aria-label="Priorité"><option value="">Toutes les priorités</option>' + PRIOS.map(([k, l]) => '<option value="' + k + '"' + (k === S.fPrio ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
          (tab !== "tableau" ? '<select id="f-open" aria-label="Statut"><option value="">Toutes les tâches</option><option value="1"' + (S.fOpen ? " selected" : "") + ">Tâches ouvertes</option></select>" : "") +
          '<button class="btn black" type="button" data-act="new-task"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Tâche</button></div></div></div>' +
      '<div id="tab"></div>';
    if (tab === "liste") renderListe(p); else if (tab === "echeancier") renderEcheancier(p); else renderBoard(p);
  }

  // tableau (kanban)
  function renderBoard(p) {
    const l = filtres(tachesDe(p.id));
    $("#tab").innerHTML = '<div class="board">' + STATUTS.map(([k, lab]) => {
      const col = l.filter((t) => t.statut === k).sort((a, b) => a.ordre - b.ordre);
      return '<section class="col" data-col="' + k + '"><div class="col-head">' + lab + "<span>" + col.length + '</span></div>' + col.map(carte).join("") +
        '<button class="add-task" type="button" data-quick="' + k + '"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>Ajouter une tâche</button></section>';
    }).join("") + "</div>";
  }
  function carte(t) {
    const n = (t.liste || []).length, ok = (t.liste || []).filter((x) => x.ok).length;
    return '<article class="tcard' + (t.statut === "termine" ? " done" : "") + '" draggable="true" data-task="' + t.id + '" tabindex="0"><div class="tt">' + esc(t.titre) + "</div>" +
      '<div class="ft"><span class="prio p-' + t.priorite + '">' + LBL(PRIOS, t.priorite) + "</span>" + (n ? '<span class="chk">' + ICON_LIST + ok + "/" + n + "</span>" : "") + '<span class="sp"></span>' + dueHtml(t) + avatar(t.responsable) + "</div></article>";
  }

  // liste
  function renderListe(p) {
    const k = S.sort.k, dir = S.sort.asc ? 1 : -1;
    const cmp = { titre: (a, b) => a.titre.localeCompare(b.titre, "fr"), statut: (a, b) => ST_RANK[a.statut] - ST_RANK[b.statut], priorite: (a, b) => PRIO_RANK[a.priorite] - PRIO_RANK[b.priorite], responsable: (a, b) => (a.responsable || "~").localeCompare(b.responsable || "~", "fr"), echeance: (a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999") }[k];
    const l = filtres(tachesDe(p.id)).sort((a, b) => dir * cmp(a, b) || triEcheance(a, b));
    const th = (key, lab) => '<th data-sort="' + key + '" class="' + (k === key ? "on" + (S.sort.asc ? " asc" : "") : "") + '">' + lab + "</th>";
    $("#tab").innerHTML = l.length ? '<div class="table-wrap"><table class="tasks"><thead><tr><th style="width:44px"></th>' + th("titre", "Tâche") + th("statut", "Statut") + th("priorite", "Priorité") + th("responsable", "Responsable") + th("echeance", "Échéance") + "</tr></thead><tbody>" + l.map((t) => ligne(t, false)).join("") + "</tbody></table></div>"
      : '<div class="card empty-state">Aucune tâche' + (tachesDe(p.id).length ? " ne correspond aux filtres." : " dans ce projet.") + '<br><button class="btn black" type="button" data-act="new-task">Ajouter une tâche</button></div>';
  }

  // échéancier
  function renderEcheancier(p) {
    const l = filtres(tachesDe(p.id));
    const dat = l.filter((t) => t.debut || t.echeance).sort((a, b) => (a.debut || a.echeance).localeCompare(b.debut || b.echeance));
    const sans = l.filter((t) => !t.debut && !t.echeance);
    $("#tab").innerHTML = '<div class="gantt" id="gantt"></div>' + (sans.length ? '<div class="card" style="margin-top:14px"><h2>Sans date <small>' + sans.length + '</small></h2><div class="dl">' + sans.map((t) => '<button type="button" data-task="' + t.id + '">' + avatar(t.responsable) + '<span class="t">' + esc(t.titre) + '</span><span class="pill s-' + t.statut + '">' + LBL(STATUTS, t.statut) + "</span></button>").join("") + "</div></div>" : "");
    if (!dat.length) { $("#gantt").innerHTML = '<div class="empty-state">Donnez une date de début ou une échéance aux tâches pour les voir sur l’échéancier.<br><small>Glissez ensuite les barres pour les déplacer dans le temps.</small></div>'; return; }
    gantt($("#gantt"), dat.map((t) => ({ id: t.id, kind: "task", label: t.titre, start: t.debut || t.echeance, end: t.echeance || t.debut, ms: !!t.echeance && !t.debut && false, done: t.statut === "termine", late: enRetard(t) })), [p.debut, p.fin]);
  }

  // diagramme de Gantt générique : rows = [{ id, kind, label, start, end, color, done, late }]
  function gantt(host, rows, extra) {
    const W = 28, dates = rows.flatMap((r) => [r.start, r.end]).concat(extra || [], [today()]).filter(Boolean).sort();
    if (!dates.length) { host.innerHTML = '<div class="empty-state">Aucune date à afficher.</div>'; return; }
    const d0 = addDays(dates[0], -7), d1 = addDays(dates[dates.length - 1], 21), n = diffDays(d0, d1) + 1;
    let months = "", days = "", shade = "", cur = null, start = 0;
    for (let i = 0; i < n; i++) {
      const d = parse(addDays(d0, i)), dow = d.getDay(), key = d.getFullYear() + "-" + d.getMonth();
      if (key !== cur) { if (cur !== null) months += '<div style="width:' + (i - start) * W + 'px"><span>' + esc(parse(addDays(d0, start)).toLocaleDateString("fr-CA", { month: "long", year: "numeric" })) + "</span></div>"; cur = key; start = i; }
      days += '<div class="' + (dow === 0 || dow === 6 ? "we" : "") + (dow === 1 ? " wk" : "") + '" style="width:' + W + 'px">' + d.getDate() + "</div>";
      if (dow === 0 || dow === 6) shade += '<div class="g-shade" style="left:' + i * W + "px;width:" + W + 'px"></div>';
    }
    months += '<div style="width:' + (n - start) * W + 'px"><span>' + esc(parse(addDays(d0, start)).toLocaleDateString("fr-CA", { month: "long", year: "numeric" })) + "</span></div>";
    const x = (s) => diffDays(d0, s) * W;
    const left = rows.map((r) => '<div class="g-row" data-' + (r.kind === "proj" ? "gproj" : "task") + '="' + r.id + '">' + (r.kind === "proj" ? '<i class="dot" style="width:8px;height:8px;border-radius:50%;flex:none;background:' + esc(r.color || "#000") + '"></i>' : "") + "<span>" + esc(r.label) + "</span></div>").join("");
    const right = rows.map((r) => {
      if (!r.start) return '<div class="g-row"><span class="g-none">Pas de date</span></div>';
      const a = r.start <= r.end ? r.start : r.end, b = r.start <= r.end ? r.end : r.start;
      const cls = "g-bar" + (r.kind === "proj" ? " proj" : "") + (r.done ? " done" : r.late ? " late" : "");
      return '<div class="g-row" style="position:relative"><div class="' + cls + '" data-bar="' + r.id + '" data-kind="' + r.kind + '" style="left:' + x(a) + "px;width:" + Math.max(W, (diffDays(a, b) + 1) * W) + "px;" + (r.color ? "--c:" + esc(r.color) : "") + '" title="' + esc(r.label + " · " + fmtD(a) + " → " + fmtD(b)) + '">' + (r.kind === "proj" ? "" : esc(r.label)) + "</div></div>";
    }).join("");
    host.innerHTML = '<div class="g-grid"><div class="g-left"><div class="g-head">' + (rows[0] && rows[0].kind === "proj" ? "Projet" : "Tâche") + "</div>" + left + '</div><div class="g-right" style="width:' + n * W + 'px"><div class="g-head"><div class="g-months">' + months + '</div><div class="g-days">' + days + '</div></div><div class="g-body">' + shade + '<div class="g-today" style="left:' + (x(today()) + W / 2 - 1) + 'px"></div>' + right + "</div></div></div>";
    host.scrollLeft = Math.max(0, x(today()) - 200);
    // glisser une barre de tâche = la déplacer dans le temps (jours entiers)
    $$('.g-bar[data-kind="task"]', host).forEach((bar) => {
      bar.addEventListener("pointerdown", (e) => {
        const t = S.taches.find((z) => z.id === bar.dataset.bar); if (!t || e.button !== 0) return;
        const x0 = e.clientX, l0 = parseFloat(bar.style.left); let dd = 0, moved = false;
        bar.setPointerCapture(e.pointerId);
        const mv = (ev) => { dd = Math.round((ev.clientX - x0) / W); if (Math.abs(ev.clientX - x0) > 3) moved = true; bar.style.left = l0 + dd * W + "px"; };
        const up = () => {
          bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up);
          if (!moved) { openTask(t.id); return; }
          if (!dd) return;
          const patch = {}; if (t.debut) patch.debut = addDays(t.debut, dd); if (t.echeance) patch.echeance = addDays(t.echeance, dd);
          majTache(t, patch); toast("« " + t.titre + " » déplacée de " + (dd > 0 ? "+" : "") + dd + " j");
        };
        bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up);
      });
    });
  }

  // ───────────────────────── tâches : création, mise à jour ─────────────────────────
  async function nouvelleTache(pid, statut, titre, extra) {
    const col = S.taches.filter((t) => t.projet_id === pid && t.statut === statut);
    const row = Object.assign({ projet_id: pid, titre: titre.trim(), statut, priorite: "normale", liste: [], ordre: (col.length ? Math.max(...col.map((t) => t.ordre)) : 0) + 1024 }, extra || {});
    if (statut === "termine") row.termine_le = new Date().toISOString();
    const tmp = Object.assign({ id: "tmp-" + uid(), cree_le: new Date().toISOString() }, row); S.taches.push(tmp); render();
    const r = await persist(() => Store.insert("pm_taches", row), "Création de la tâche impossible");
    if (r) { Object.assign(tmp, r); render(); }
    return tmp;
  }
  function majTache(t, patch, silencieux) {
    if (patch.statut && patch.statut !== t.statut) patch.termine_le = patch.statut === "termine" ? new Date().toISOString() : null;
    Object.assign(t, patch); if (!silencieux) render();
    if (String(t.id).startsWith("tmp-")) return;
    return persist(() => Store.update("pm_taches", t.id, patch), "Modification impossible");
  }

  // drag & drop du tableau
  let dragId = null;
  function initBoardDnD() {
    const view = $("#view");
    view.addEventListener("dragstart", (e) => { const c = e.target.closest(".tcard"); if (!c) return; dragId = c.dataset.task; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch (_) {} });
    view.addEventListener("dragend", () => { dragId = null; $$(".tcard.dragging").forEach((c) => c.classList.remove("dragging")); $$(".col.over").forEach((c) => c.classList.remove("over")); $$(".drop-line").forEach((d) => d.remove()); });
    view.addEventListener("dragover", (e) => {
      const col = e.target.closest(".col"); if (!col || !dragId) return; e.preventDefault();
      $$(".col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over");
      const after = $$(".tcard:not(.dragging)", col).find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      let line = $(".drop-line"); if (!line) { line = document.createElement("div"); line.className = "drop-line"; }
      if (after) col.insertBefore(line, after); else col.insertBefore(line, $(".add-task", col));
    });
    view.addEventListener("drop", (e) => {
      const col = e.target.closest(".col"); if (!col || !dragId) return; e.preventDefault();
      const t = S.taches.find((z) => z.id === dragId), line = $(".drop-line", col);
      const next = line && line.nextElementSibling && line.nextElementSibling.classList.contains("tcard") ? S.taches.find((z) => z.id === line.nextElementSibling.dataset.task) : null;
      const prevEl = line && line.previousElementSibling && line.previousElementSibling.classList.contains("tcard") ? line.previousElementSibling : null;
      const prev = prevEl ? S.taches.find((z) => z.id === prevEl.dataset.task) : null;
      const ordre = prev && next ? (prev.ordre + next.ordre) / 2 : prev ? prev.ordre + 1024 : next ? next.ordre - 1024 : 1024;
      if (t) majTache(t, { statut: col.dataset.col, ordre });
    });
  }

  // ───────────────────────── fiche d'une tâche ─────────────────────────
  let openId = null, textTimer = null;
  function openTask(id) {
    const t = S.taches.find((z) => z.id === id); if (!t) return; openId = id;
    const d = $("#task-dlg"), p = proj(t.projet_id) || {};
    d.innerHTML =
      '<div class="d-head"><span class="crumb">' + esc(p.nom || "") + '</span><button type="button" class="btn ghost" data-d="done">' + (t.statut === "termine" ? "Rouvrir" : ICON_CHECK.replace("<svg", '<svg width="16" height="16"') + "Marquer terminée") + '</button><button type="button" class="icon-btn" data-d="close" aria-label="Fermer">×</button></div>' +
      '<div class="d-body"><textarea class="d-title" rows="1" id="d-titre" aria-label="Titre">' + esc(t.titre) + "</textarea>" +
        '<div class="props">' +
          '<span>Statut</span><select id="d-statut">' + STATUTS.map(([k, l]) => '<option value="' + k + '"' + (k === t.statut ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
          '<span>Priorité</span><select id="d-prio">' + PRIOS.map(([k, l]) => '<option value="' + k + '"' + (k === t.priorite ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" +
          '<span>Responsable</span><input id="d-resp" list="people" value="' + esc(t.responsable || "") + '" placeholder="Nom ou courriel">' +
          '<span>Début</span><input id="d-debut" type="date" value="' + esc(t.debut || "") + '">' +
          '<span>Échéance</span><input id="d-ech" type="date" value="' + esc(t.echeance || "") + '">' +
          '<span>Estimation</span><input id="d-est" type="number" min="0" step="0.5" value="' + esc(t.estimation_h == null ? "" : t.estimation_h) + '" placeholder="Heures">' +
          '<span>Projet</span><select id="d-proj">' + S.projets.map((x) => '<option value="' + x.id + '"' + (x.id === t.projet_id ? " selected" : "") + ">" + esc(x.nom) + "</option>").join("") + "</select>" +
        "</div>" +
        '<label class="field-l"><span>Description</span><textarea id="d-desc" placeholder="Contexte, livrables, liens…">' + esc(t.description || "") + "</textarea></label>" +
        '<div class="field-l"><span>Sous-tâches</span><div class="checklist" id="d-list"></div></div>' +
      "</div>" +
      '<div class="d-foot"><span>' + (t.cree_le ? "Créée le " + esc(fmtD(t.cree_le.slice(0, 10), true)) : "") + (t.termine_le ? " · terminée le " + esc(fmtD(t.termine_le.slice(0, 10), true)) : "") + '</span><button type="button" class="btn danger" data-d="del">Supprimer</button></div>';
    renderChecklist(t);
    if (!d.open) d.showModal();
    autosize($("#d-titre"));
  }
  function autosize(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  function renderChecklist(t) {
    const l = t.liste || [];
    $("#d-list").innerHTML = l.map((x, i) => '<label class="' + (x.ok ? "ok" : "") + '"><input type="checkbox" data-ck="' + i + '"' + (x.ok ? " checked" : "") + '><input type="text" data-ct="' + i + '" value="' + esc(x.t) + '"><button type="button" class="x" data-cx="' + i + '" aria-label="Retirer">×</button></label>').join("") +
      '<div class="add"><input id="d-ck-new" placeholder="Ajouter une sous-tâche puis Entrée"></div>';
  }
  function initDrawer() {
    const d = $("#task-dlg");
    const cur = () => S.taches.find((z) => z.id === openId);
    d.addEventListener("click", (e) => {
      if (e.target === d) return d.close();
      const b = e.target.closest("[data-d]"); const t = cur(); if (!b || !t) { const cx = e.target.closest("[data-cx]"); if (cx && t) { t.liste.splice(+cx.dataset.cx, 1); renderChecklist(t); majTache(t, { liste: t.liste }); } return; }
      if (b.dataset.d === "close") d.close();
      if (b.dataset.d === "done") { majTache(t, { statut: t.statut === "termine" ? "a_faire" : "termine" }); openTask(t.id); }
      if (b.dataset.d === "del") confirmer("Supprimer la tâche ?", "« " + t.titre + " » sera supprimée définitivement.", "Supprimer").then((ok) => {
        if (!ok) return; d.close(); S.taches = S.taches.filter((z) => z.id !== t.id); render(); persist(() => Store.remove("pm_taches", t.id), "Suppression impossible"); toast("Tâche supprimée");
      });
    });
    d.addEventListener("change", (e) => {
      const t = cur(); if (!t) return; const id = e.target.id;
      const map = { "d-statut": "statut", "d-prio": "priorite", "d-debut": "debut", "d-ech": "echeance", "d-proj": "projet_id", "d-resp": "responsable" };
      if (map[id]) {
        const v = e.target.value.trim() || null, patch = { [map[id]]: v };
        if (id === "d-proj" && v) { const col = S.taches.filter((z) => z.projet_id === v && z.statut === t.statut); patch.ordre = (col.length ? Math.max(...col.map((z) => z.ordre)) : 0) + 1024; }
        if (id === "d-debut" && v && t.echeance && v > t.echeance) { patch.echeance = v; $("#d-ech").value = v; }
        if (id === "d-ech" && v && t.debut && v < t.debut) { patch.debut = v; $("#d-debut").value = v; }
        majTache(t, patch); if (id === "d-statut") openTask(t.id);
        if (id === "d-resp") refreshPeople();
      }
      if (id === "d-est") majTache(t, { estimation_h: e.target.value === "" ? null : Number(e.target.value) });
      if (e.target.dataset.ck != null) { t.liste[+e.target.dataset.ck].ok = e.target.checked; renderChecklist(t); majTache(t, { liste: t.liste }); }
      if (e.target.dataset.ct != null) { const i = +e.target.dataset.ct, v = e.target.value.trim(); if (v) t.liste[i].t = v; else t.liste.splice(i, 1); renderChecklist(t); majTache(t, { liste: t.liste }); }
    });
    d.addEventListener("input", (e) => {
      const t = cur(); if (!t) return;
      if (e.target.id === "d-titre") autosize(e.target);
      if (e.target.id === "d-titre" || e.target.id === "d-desc") {
        clearTimeout(textTimer);
        const titre = $("#d-titre").value.trim(), desc = $("#d-desc").value;
        textTimer = setTimeout(() => { const patch = { description: desc || null }; if (titre) patch.titre = titre; majTache(t, patch); }, 600);
      }
    });
    d.addEventListener("keydown", (e) => {
      if (e.target.id === "d-titre" && e.key === "Enter") { e.preventDefault(); e.target.blur(); }
      if (e.target.id === "d-ck-new" && e.key === "Enter") {
        e.preventDefault(); const t = cur(), v = e.target.value.trim(); if (!t || !v) return;
        t.liste = (t.liste || []).concat({ t: v, ok: false }); renderChecklist(t); majTache(t, { liste: t.liste }); $("#d-ck-new").focus();
      }
    });
    d.addEventListener("close", () => {
      // enregistre un titre ou une description encore en attente
      if (textTimer) { clearTimeout(textTimer); textTimer = null; const t = cur(); if (t) { const titre = $("#d-titre").value.trim(), desc = $("#d-desc").value; if ((titre && titre !== t.titre) || (desc || null) !== (t.description || null)) majTache(t, Object.assign({ description: desc || null }, titre ? { titre } : {})); } }
      openId = null;
    });
  }

  // ───────────────────────── projets : création, modification ─────────────────────────
  function projetDialog(p) {
    const d = $("#proj-dlg"), c = (p && p.couleur) || COULEURS[S.projets.length % COULEURS.length];
    d.innerHTML = '<form method="dialog" id="proj-form"><h3>' + (p ? "Modifier le projet" : "Nouveau projet") + "</h3>" +
      '<div class="fields"><label class="fl full">Nom<input name="nom" required maxlength="120" value="' + esc(p ? p.nom : "") + '" placeholder="Ex. Implantation ERP — phase 1"></label>' +
      '<label class="fl full">Description<textarea name="description" placeholder="Objectif, périmètre, livrables">' + esc(p ? p.description || "" : "") + "</textarea></label>" +
      '<label class="fl">Responsable<input name="responsable" list="people" value="' + esc(p ? p.responsable || "" : (S.me && S.me.nom) || "") + '"></label>' +
      '<label class="fl">Statut<select name="statut">' + PSTATUTS.map(([k, l]) => '<option value="' + k + '"' + ((p ? p.statut : "en_cours") === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
      '<label class="fl">Début<input type="date" name="debut" value="' + esc(p ? p.debut || "" : today()) + '"></label>' +
      '<label class="fl">Fin prévue<input type="date" name="fin" value="' + esc(p ? p.fin || "" : "") + '"></label>' +
      '<div class="fl full">Couleur<div class="swatches">' + COULEURS.map((x, i) => '<input type="radio" name="couleur" id="sw' + i + '" value="' + x + '"' + (x === c ? " checked" : "") + '><label for="sw' + i + '" style="--c:' + x + '" title="' + x + '"></label>').join("") + "</div></div></div>" +
      '<p class="m-err" id="proj-err" hidden></p><div class="m-foot"><button class="btn" type="button" value="cancel" data-m="cancel">Annuler</button><button class="btn black" type="submit">' + (p ? "Enregistrer" : "Créer le projet") + "</button></div></form>";
    d.showModal();
    $("[data-m=cancel]", d).onclick = () => d.close();
    $("#proj-form").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), row = {};
      ["nom", "description", "responsable", "statut", "debut", "fin", "couleur"].forEach((k) => { const v = String(f.get(k) || "").trim(); row[k] = v || null; });
      if (!row.nom) return;
      if (row.debut && row.fin && row.fin < row.debut) { const er = $("#proj-err"); er.textContent = "La fin prévue précède le début."; er.hidden = false; return; }
      d.close();
      if (p) { Object.assign(p, row); render(); await persist(() => Store.update("pm_projets", p.id, row), "Modification du projet impossible"); toast("Projet enregistré"); }
      else {
        const r = await persist(() => Store.insert("pm_projets", row), "Création du projet impossible");
        if (r) { S.projets.push(r); location.hash = "projet/" + r.id + "/tableau"; toast("Projet « " + r.nom + " » créé"); refreshPeople(); }
      }
    };
  }
  function confirmer(titre, texte, bouton) {
    return new Promise((res) => {
      const d = $("#confirm-dlg");
      d.innerHTML = '<div class="m-in"><h3>' + esc(titre) + "</h3><p>" + esc(texte) + '</p><div class="m-foot"><button class="btn" type="button" data-c="0">Annuler</button><button class="btn black" type="button" data-c="1">' + esc(bouton) + "</button></div></div>";
      let v = false; d.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) { v = b.dataset.c === "1"; d.close(); } else if (e.target === d) d.close(); };
      d.onclose = () => res(v); d.showModal();
    });
  }

  // ───────────────────────── événements du contenu ─────────────────────────
  function initView() {
    const view = $("#view");
    view.addEventListener("click", (e) => {
      const tog = e.target.closest("[data-toggle]");
      if (tog) { e.stopPropagation(); const t = S.taches.find((z) => z.id === tog.dataset.toggle); if (t) majTache(t, { statut: t.statut === "termine" ? "a_faire" : "termine" }); return; }
      const act = e.target.closest("[data-act]");
      if (act) {
        const a = act.dataset.act, p = proj(S.route.id);
        if (a === "new-proj") projetDialog(null);
        if (a === "edit-proj" && p) projetDialog(p);
        if (a === "del-proj" && p) confirmer("Supprimer le projet ?", "« " + p.nom + " » et ses " + tachesDe(p.id).length + " tâches seront supprimés définitivement.", "Supprimer").then((ok) => {
          if (!ok) return; S.projets = S.projets.filter((x) => x.id !== p.id); S.taches = S.taches.filter((t) => t.projet_id !== p.id); location.hash = "apercu";
          persist(() => Store.remove("pm_projets", p.id), "Suppression impossible"); toast("Projet supprimé");
        });
        if (a === "new-task" && p) { if (S.route.tab !== "tableau") { S.route.tab = "tableau"; history.replaceState(null, "", "#projet/" + p.id + "/tableau"); render(); } quickAdd("a_faire"); }
        return;
      }
      const tab = e.target.closest("[data-tab]");
      if (tab) { try { localStorage.setItem(TAB_KEY, tab.dataset.tab); } catch (_) {} location.hash = "projet/" + S.route.id + "/" + tab.dataset.tab; return; }
      const so = e.target.closest("[data-sort]");
      if (so) { S.sort = { k: so.dataset.sort, asc: S.sort.k === so.dataset.sort ? !S.sort.asc : true }; render(); return; }
      const q = e.target.closest("[data-quick]");
      if (q) { quickAdd(q.dataset.quick); return; }
      const g = e.target.closest("[data-gproj]");
      if (g) { location.hash = "projet/" + g.dataset.gproj + "/echeancier"; return; }
      const gb = e.target.closest('[data-bar][data-kind="proj"]');
      if (gb) { location.hash = "projet/" + gb.dataset.bar + "/echeancier"; return; }
      const t = e.target.closest("[data-task]");
      if (t && !e.target.closest(".g-bar")) openTask(t.dataset.task);
    });
    view.addEventListener("keydown", (e) => { const c = e.target.closest(".tcard"); if (c && e.key === "Enter") openTask(c.dataset.task); });
    view.addEventListener("change", (e) => {
      if (e.target.id === "f-resp") S.fResp = e.target.value;
      else if (e.target.id === "f-prio") S.fPrio = e.target.value;
      else if (e.target.id === "f-open") S.fOpen = e.target.value;
      else return;
      render();
    });
  }
  function quickAdd(statut) {
    const col = $('.col[data-col="' + statut + '"]'); if (!col) return;
    const btn = $(".add-task", col); if (!btn) { const ta = $(".quick textarea", col); if (ta) ta.focus(); return; }
    const box = document.createElement("div"); box.className = "quick";
    box.innerHTML = '<textarea placeholder="Titre de la tâche — Entrée pour ajouter, Échap pour fermer"></textarea><div class="row"><button class="btn black" type="button" data-q="ok">Ajouter</button><button class="btn ghost" type="button" data-q="no">Fermer</button></div>';
    btn.replaceWith(box); const ta = $("textarea", box); ta.focus();
    const add = () => { const v = ta.value.trim(); if (!v) return; ta.value = ""; nouvelleTache(S.route.id, statut, v).then(() => quickAdd(statut)); };
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === "Escape") { e.preventDefault(); render(); } });
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (!b) return; e.stopPropagation(); if (b.dataset.q === "ok") add(); else render(); });
  }

  // ───────────────────────── démarrage ─────────────────────────
  async function refreshPeople() {
    let ppl = []; try { ppl = await Store.people(); } catch (_) {}
    const names = new Set(ppl.map((x) => x.nom || x.email).filter(Boolean));
    S.taches.concat(S.projets).forEach((x) => x.responsable && names.add(x.responsable));
    $("#people").innerHTML = [...names].sort((a, b) => a.localeCompare(b, "fr")).map((n) => '<option value="' + esc(n) + '">').join("");
  }
  async function reload() {
    try { await Store.load(); S.loadedAt = Date.now(); }
    catch (e) {
      if (tableManquante(e)) return setup();
      console.error(e); toast("Lecture impossible : " + (e.message || e), false);
    }
    if (S.route.v === "projet" && !proj(S.route.id)) location.hash = "apercu";
    render();
  }
  function setup() {
    $("#view").innerHTML = '<div class="card setup"><h1 class="title">Une dernière étape</h1><p class="sub">La base en ligne n’a pas encore les tables de Projets.</p><ol>' +
      "<li>Ouvrez Supabase → projet « Lens Diagnostic » → <b>SQL Editor</b>.</li><li>Collez le contenu du fichier <code>supabase/projets.sql</code> du dépôt <code>groupe-lounici-erp</code>, puis <b>Run</b>.</li><li>Rechargez cette page.</li></ol></div>";
    $("#proj-list").innerHTML = ""; S.projets = []; S.taches = [];
  }

  async function start() {
    $("#side-scrim").onclick = $("#side-close").onclick = () => $("#app").classList.remove("menu");
    $("#menu-btn").onclick = () => $("#app").classList.add("menu");
    $("#new-proj").onclick = () => projetDialog(null);
    let qt; $("#search").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 150); });
    initView(); initBoardDnD(); initDrawer();
    window.addEventListener("hashchange", route);

    if (S.cloud) {
      try { S.me = await LensCloud.me(); } catch (e) { console.error(e); }
      if (!S.me) { $("#view").innerHTML = '<div class="card setup"><h1 class="title">Session expirée</h1><p class="sub">Reconnectez-vous pour accéder à Projets.</p><p style="margin-top:16px"><a class="btn black" href="index.html">Se connecter</a></p></div>'; try { sessionStorage.removeItem("portail"); } catch (_) {} return; }
      if (S.me.role === "lounici") {
        const c = await LensCloud.client(); const { data } = await c.from("entreprises").select("id, nom").order("nom");
        S.ents = data || [];
        let saved = null; try { saved = localStorage.getItem(ENT_KEY); } catch (_) {}
        S.ent = saved != null && (saved === "" || S.ents.some((e) => e.id === saved)) ? saved || null : S.me.entreprise_id || null;
        const sel = $("#ent"); sel.innerHTML = '<option value="">Groupe Lounici (interne)</option>' + S.ents.map((e) => '<option value="' + e.id + '">' + esc(e.nom) + "</option>").join("");
        sel.value = S.ent || ""; $("#ent-wrap").hidden = false;
        sel.onchange = async () => { S.ent = sel.value || null; try { localStorage.setItem(ENT_KEY, sel.value); } catch (_) {} S.fResp = ""; if (location.hash !== "#apercu") location.hash = "apercu"; await reload(); refreshPeople(); };
      } else S.ent = S.me.entreprise_id || null;
      $("#who").textContent = (S.me.nom || S.me.email || "") + (S.me.entreprises && S.me.entreprises.nom ? " · " + S.me.entreprises.nom : S.me.role === "lounici" ? " · Groupe Lounici" : "");
    } else { S.me = { nom: "Moi" }; $("#who").textContent = "Mode local · ce navigateur"; }

    sync(0);
    await reload(); refreshPeople(); route();
    // travail à plusieurs : on relit la base en revenant sur l'onglet (au plus toutes les 30 s)
    window.addEventListener("focus", () => { if (Date.now() - S.loadedAt > 30000 && !$("#task-dlg").open && !$("#proj-dlg").open) reload(); });
  }
  start();
})();
