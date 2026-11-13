// CRM — suivi des clients et prospects contactés par Groupe Lounici (ERP). Aucune dépendance hormis le client Supabase de lens-cloud.js.
// Données : tables crm_comptes / crm_contacts / crm_activites (supabase/crm.sql), réservées au rôle lounici par RLS.
// Sans configuration Supabase : mode local, données dans ce navigateur (localStorage « erp.crm »).
(function () {
  "use strict";

  // ───────────────────────── constantes ─────────────────────────
  const ETAPES = [["prospect", "Prospect"], ["contacte", "Contacté"], ["rencontre", "Rencontre"], ["proposition", "Proposition"], ["gagne", "Gagné"], ["perdu", "Perdu"]];
  const ACTIVES = ["prospect", "contacte", "rencontre", "proposition"];
  const ICONS = {
    appel: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    courriel: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    rencontre: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15 14.5c2.8-.4 6 1 6 4.5"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>',
    message: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/></svg>',
  };
  const TYPES = [["appel", "Appel"], ["courriel", "Courriel"], ["rencontre", "Rencontre"], ["linkedin", "LinkedIn"], ["message", "Message"], ["note", "Note"]];
  const RESULTATS = ["Intéressé", "Rencontre fixée", "Proposition demandée", "À rappeler", "Message laissé", "Pas de réponse", "Pas intéressé"];
  const LBL = (list, k) => (list.find((x) => x[0] === k) || [k, k])[1];
  const LOCAL_KEY = "erp.crm", DAY = 86400000;

  // ───────────────────────── outils ─────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => iso(new Date());
  const parse = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => iso(new Date(parse(s).getTime() + n * DAY + 3600000));
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const localDT = (d) => iso(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  const fmtD = (s) => { const d = parse(s); if (!d) return ""; const o = { day: "numeric", month: "short" }; if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return d.toLocaleDateString("fr-CA", o); };
  const fmtT = (ts) => new Date(ts).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
  const money = (v) => v == null || v === "" ? "" : Number(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
  const initials = (n) => { const p = String(n || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean); return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase(); };
  const depuis = (ts) => {
    if (!ts) return "jamais"; const n = diffDays(iso(new Date(ts)), today());
    return n <= 0 ? "aujourd’hui" : n === 1 ? "hier" : n < 14 ? "il y a " + n + " j" : n < 60 ? "il y a " + Math.round(n / 7) + " sem." : "il y a " + Math.round(n / 30) + " mois";
  };
  const lien = (u) => !u ? "" : /^https?:\/\//i.test(u) ? u : "https://" + u;

  function toast(msg, ok) {
    const t = document.createElement("div"); t.className = "toast" + (ok === false ? " err" : ""); t.textContent = msg;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), ok === false ? 5200 : 2800);
  }
  let pending = 0;
  function sync(delta) { pending += delta; $("#sync").textContent = pending > 0 ? "Enregistrement…" : S.cloud ? "Enregistré en ligne" : "Enregistré dans ce navigateur"; }

  // ───────────────────────── état ─────────────────────────
  const S = { cloud: !!(window.LensCloud && LensCloud.enabled), me: null, comptes: [], contacts: [], activites: [], route: { v: "apercu" }, q: "", fEtape: "", fType: "", sort: { k: "dernier", asc: false }, loadedAt: 0 };
  const T = { comptes: "crm_comptes", contacts: "crm_contacts", activites: "crm_activites" };

  // ───────────────────────── stockage ─────────────────────────
  const tableManquante = (e) => e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache|Could not find the table/i.test(e.message || ""));
  const Local = {
    read() { try { return Object.assign({ comptes: [], contacts: [], activites: [] }, JSON.parse(localStorage.getItem(LOCAL_KEY))); } catch (_) { return { comptes: [], contacts: [], activites: [] }; } },
    write(d) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch (_) { toast("Stockage du navigateur indisponible", false); } },
  };
  const Store = {
    async load() {
      if (!S.cloud) { const d = Local.read(); Object.assign(S, { comptes: d.comptes, contacts: d.contacts, activites: d.activites }); return; }
      const c = await LensCloud.client();
      const [a, b, e] = await Promise.all([c.from(T.comptes).select("*").order("nom"), c.from(T.contacts).select("*").order("nom"), c.from(T.activites).select("*").order("quand", { ascending: false }).limit(5000)]);
      for (const r of [a, b, e]) if (r.error) throw r.error;
      S.comptes = a.data || []; S.contacts = b.data || []; S.activites = e.data || [];
    },
    async insert(k, row) {
      if (!S.cloud) { const d = Local.read(), now = new Date().toISOString(); const r = Object.assign({ id: uid(), cree_le: now, maj_le: now }, row); d[k].push(r); Local.write(d); return r; }
      const c = await LensCloud.client(); const { data, error } = await c.from(T[k]).insert(row).select().single(); if (error) throw error; return data;
    },
    async update(k, id, patch) {
      if (!S.cloud) { const d = Local.read(), r = d[k].find((x) => x.id === id); if (r) Object.assign(r, patch, { maj_le: new Date().toISOString() }); Local.write(d); return r; }
      const c = await LensCloud.client(); const { data, error } = await c.from(T[k]).update(patch).eq("id", id).select().single(); if (error) throw error; return data;
    },
    async remove(k, id) {
      if (!S.cloud) {
        const d = Local.read(); d[k] = d[k].filter((x) => x.id !== id);
        if (k === "comptes") { d.contacts = d.contacts.filter((x) => x.compte_id !== id); d.activites = d.activites.filter((x) => x.compte_id !== id); }
        if (k === "contacts") d.activites.forEach((x) => { if (x.contact_id === id) x.contact_id = null; });
        Local.write(d); return;
      }
      const c = await LensCloud.client(); const { error } = await c.from(T[k]).delete().eq("id", id); if (error) throw error;
    },
  };
  async function persist(fn, quoi) {
    sync(1);
    try { return await fn(); }
    catch (e) { console.error(e); toast((quoi || "Enregistrement impossible") + " : " + (e.message || e), false); await reload(); return null; }
    finally { sync(-1); }
  }

  // ───────────────────────── calculs ─────────────────────────
  const compte = (id) => S.comptes.find((x) => x.id === id);
  const contact = (id) => S.contacts.find((x) => x.id === id);
  const contactsDe = (id) => S.contacts.filter((x) => x.compte_id === id);
  const activitesDe = (id) => S.activites.filter((x) => x.compte_id === id).sort((a, b) => b.quand.localeCompare(a.quand));
  const dernier = (id) => { const a = S.activites.find((x) => x.compte_id === id && x.type !== "note"); return a ? a.quand : null; };   // activites triées du plus récent au plus ancien
  const trierActivites = () => S.activites.sort((a, b) => b.quand.localeCompare(a.quand));
  const relanceEtat = (c) => !c.prochaine_relance ? "" : c.prochaine_relance < today() ? "late" : c.prochaine_relance === today() ? "today" : "";
  const aRelancer = () => S.comptes.filter((c) => c.prochaine_relance && c.prochaine_relance <= today());
  const trouve = (c) => {
    if (!S.q) return true;
    const t = [c.nom, c.secteur, c.ville, c.notes, c.source, c.relance_note].concat(contactsDe(c.id).flatMap((x) => [x.nom, x.courriel, x.poste])).join(" ").toLowerCase();
    return t.includes(S.q);
  };
  const stage = (e) => '<span class="stage e-' + e + '">' + LBL(ETAPES, e) + "</span>";
  const relanceHtml = (c) => {
    if (!c.prochaine_relance) return '<span class="due">—</span>';
    const st = relanceEtat(c), n = diffDays(today(), c.prochaine_relance);
    return '<span class="due' + (st === "late" ? " late" : st === "today" ? " soon" : "") + '">' + (n === 0 ? "Aujourd’hui" : n === 1 ? "Demain" : esc(fmtD(c.prochaine_relance))) + "</span>";
  };

  // ───────────────────────── barre latérale, routage ─────────────────────────
  function renderSide() {
    $$(".side-nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === S.route.v));
    const vus = []; for (const a of S.activites) { if (!vus.includes(a.compte_id) && compte(a.compte_id)) vus.push(a.compte_id); if (vus.length === 8) break; }
    $("#recent").innerHTML = vus.length ? vus.map((id) => { const c = compte(id); return '<li><a href="#client/' + id + '" class="' + (S.route.v === "client" && S.route.id === id ? "on" : "") + '"><i class="dot" style="--c:#fff;opacity:.5"></i><span class="nm">' + esc(c.nom) + '</span><span class="pc">' + esc(depuis(dernier(id))) + "</span></a></li>"; }).join("") : '<li class="empty">Aucun échange pour l’instant.</li>';
    const n = aRelancer().length, b = $("#due-count"); b.hidden = !n; b.textContent = n;
    $("#accounts").innerHTML = S.comptes.map((c) => '<option value="' + esc(c.nom) + '">').join("");
    $("#sectors").innerHTML = [...new Set(S.comptes.map((c) => c.secteur).filter(Boolean))].sort().map((s) => '<option value="' + esc(s) + '">').join("");
  }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)), m = /^client\/(.+)$/.exec(h);
    if (m && compte(m[1])) S.route = { v: "client", id: m[1] };
    else S.route = { v: ["relances", "pipeline", "clients", "journal"].includes(h) ? h : "apercu" };
    $("#app").classList.remove("menu");
    render();
  }
  function render() {
    renderSide();
    const v = S.route.v;
    if (S.q && v !== "clients" && v !== "journal") return renderSearch();
    ({ apercu: renderApercu, relances: renderRelances, pipeline: renderPipeline, clients: renderClients, journal: renderJournal, client: renderClient })[v]();
  }

  // ───────────────────────── fil des échanges ─────────────────────────
  function feed(list, avecClient, parJour) {
    if (!list.length) return '<div class="empty-state">Aucun échange.</div>';
    let jour = "", out = "";
    list.forEach((a) => {
      const d = iso(new Date(a.quand));
      if (parJour && d !== jour) { jour = d; const n = diffDays(d, today()); out += '<div class="day-sep">' + (n === 0 ? "Aujourd’hui" : n === 1 ? "Hier" : esc(new Date(a.quand).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))) + "</div>"; }
      const c = compte(a.compte_id), ct = contact(a.contact_id);
      out += '<div class="it"><span class="kind k-' + a.type + '" title="' + LBL(TYPES, a.type) + '">' + ICONS[a.type] + "</span><div><div class=\"hd\">" +
        (avecClient && c ? '<a href="#client/' + c.id + '">' + esc(c.nom) + "</a>" : "") +
        "<b>" + LBL(TYPES, a.type) + (a.type !== "note" ? (a.sens === "entrant" ? " reçu" + (a.type === "rencontre" ? "e" : "") : "") : "") + "</b>" +
        (ct ? "<small>avec " + esc(ct.nom) + "</small>" : "") + (a.sujet ? "<small>· " + esc(a.sujet) + "</small>" : "") + "</div>" +
        (a.notes ? '<div class="nt">' + esc(a.notes) + "</div>" : "") + (a.resultat ? '<span class="res">' + esc(a.resultat) + "</span>" : "") +
        '</div><div class="tm"><span>' + (parJour ? esc(fmtT(a.quand)) : esc(fmtD(a.quand)) + " · " + esc(fmtT(a.quand))) + '</span><button type="button" data-del-act="' + a.id + '">Supprimer</button></div></div>';
    });
    return '<div class="feed">' + out + "</div>";
  }

  // ───────────────────────── tableau de bord ─────────────────────────
  function renderApercu() {
    const actifs = S.comptes.filter((c) => ACTIVES.includes(c.etape));
    const semaine = Date.now() - 7 * DAY, echanges7 = S.activites.filter((a) => a.type !== "note" && new Date(a.quand).getTime() >= semaine).length;
    const dues = aRelancer(), pipe = actifs.reduce((s, c) => s + (Number(c.valeur) || 0), 0);
    const prochaines = S.comptes.filter((c) => c.prochaine_relance && c.prochaine_relance <= addDays(today(), 7)).sort((a, b) => a.prochaine_relance.localeCompare(b.prochaine_relance));
    const oublies = actifs.filter((c) => !c.prochaine_relance && (!dernier(c.id) || diffDays(iso(new Date(dernier(c.id))), today()) > 30));
    const maxN = Math.max(1, ...ETAPES.map(([k]) => S.comptes.filter((c) => c.etape === k).length));
    $("#view").innerHTML =
      '<div class="page-head"><div><h1 class="title">Tableau de bord</h1><p class="sub">Vos clients et prospects, vos échanges et vos relances</p></div><div class="actions"><button class="btn" type="button" data-act="new-acc">Nouveau client</button></div></div>' +
      '<div class="kpis"><div class="kpi dark"><b>' + actifs.length + '</b><span>Clients en cours de démarchage</span></div><div class="kpi"><b>' + echanges7 + '</b><span>Échanges ces 7 derniers jours</span></div><div class="kpi' + (dues.length ? " alert" : "") + '"><b>' + dues.length + '</b><span>Relances dues</span></div><div class="kpi"><b class="money">' + (pipe ? esc(money(pipe)) : "—") + "</b><span>Valeur estimée du pipeline</span></div></div>" +
      '<div class="grid-2"><section class="card"><h2>Relances des 7 prochains jours <small><a href="#relances">Tout voir</a></small></h2>' +
        (prochaines.length ? '<div class="dl">' + prochaines.slice(0, 8).map((c) => '<button type="button" data-open="' + c.id + '"><span class="avatar">' + esc(initials(c.nom)) + '</span><span class="t">' + esc(c.nom) + "<small>" + esc(c.relance_note || LBL(ETAPES, c.etape)) + "</small></span>" + relanceHtml(c) + "</button>").join("") + "</div>" : '<div class="empty-state">Aucune relance prévue.</div>') +
      '</section><section class="card"><h2>Pipeline <small><a href="#pipeline">Ouvrir</a></small></h2><div class="dl">' +
        ETAPES.map(([k, l]) => { const l2 = S.comptes.filter((c) => c.etape === k), v = l2.reduce((s, c) => s + (Number(c.valeur) || 0), 0); return '<button type="button" data-goto="pipeline">' + stage(k) + '<span class="t"><span class="bar"><i style="--p:' + Math.round((100 * l2.length) / maxN) + '%"></i></span></span><span class="due">' + l2.length + (v ? " · " + esc(money(v)) : "") + "</span></button>"; }).join("") +
      "</div></section></div>" +
      (oublies.length ? '<section class="card" style="margin-top:14px"><h2>Sans nouvelles depuis 30 jours et sans relance <small>' + oublies.length + '</small></h2><div class="dl">' + oublies.slice(0, 8).map((c) => '<button type="button" data-open="' + c.id + '"><span class="avatar none">' + esc(initials(c.nom)) + '</span><span class="t">' + esc(c.nom) + "<small>Dernier contact : " + esc(depuis(dernier(c.id))) + "</small></span>" + stage(c.etape) + "</button>").join("") + "</div></section>" : "") +
      '<section class="card" style="margin-top:14px"><h2>Derniers échanges <small><a href="#journal">Journal complet</a></small></h2>' + (S.activites.length ? feed(S.activites.slice(0, 10), true, false) : '<div class="empty-state">Loggez votre premier contact avec le bouton « Logger un contact ».<br><button class="btn black" type="button" data-act="log">Logger un contact</button></div>') + "</section>";
  }

  // ───────────────────────── relances ─────────────────────────
  function renderRelances() {
    const t0 = today(), l = S.comptes.filter((c) => c.prochaine_relance).sort((a, b) => a.prochaine_relance.localeCompare(b.prochaine_relance));
    const g = [["En retard", (c) => c.prochaine_relance < t0], ["Aujourd’hui", (c) => c.prochaine_relance === t0], ["Cette semaine", (c) => c.prochaine_relance > t0 && diffDays(t0, c.prochaine_relance) <= 7], ["Plus tard", (c) => diffDays(t0, c.prochaine_relance) > 7]];
    const ligne = (c) => '<tr data-open="' + c.id + '"><td class="t">' + esc(c.nom) + '<span class="sm">' + esc(c.relance_note || "") + "</span></td><td>" + stage(c.etape) + "</td><td>" + esc(depuis(dernier(c.id))) + "</td><td>" + relanceHtml(c) +
      '</td><td style="white-space:nowrap;text-align:right"><button class="btn" type="button" data-log="' + c.id + '">Logger</button> <button class="btn ghost" type="button" data-snooze="' + c.id + '" title="Reporter d’une semaine">+7 j</button> <button class="btn ghost" type="button" data-done="' + c.id + '" title="Retirer la relance">Fait</button></td></tr>';
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Relances</h1><p class="sub">Les clients à recontacter, par date</p></div></div>' +
      (l.length ? '<div class="table-wrap"><table class="tasks"><thead><tr><th>Client</th><th>Étape</th><th>Dernier contact</th><th>Relance</th><th></th></tr></thead><tbody>' +
        g.map(([n, f]) => { const x = l.filter(f); return x.length ? '<tr class="group-row"><td colspan="5">' + n + " · " + x.length + "</td></tr>" + x.map(ligne).join("") : ""; }).join("") + "</tbody></table></div>"
        : '<div class="card empty-state">Aucune relance prévue. Programmez-en une en loggant un échange.</div>');
  }

  // ───────────────────────── pipeline ─────────────────────────
  function renderPipeline() {
    const l = S.comptes.filter(trouve);
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Pipeline</h1><p class="sub">Glissez un client d’une étape à l’autre</p></div><div class="actions"><button class="btn" type="button" data-act="new-acc">Nouveau client</button></div></div><div class="pipe">' +
      ETAPES.map(([k, lab]) => {
        const col = l.filter((c) => c.etape === k).sort((a, b) => (dernier(b.id) || "").localeCompare(dernier(a.id) || "")), v = col.reduce((s, c) => s + (Number(c.valeur) || 0), 0);
        return '<section class="col" data-stage="' + k + '"><div class="col-head"><div>' + lab + "<span>" + col.length + "</span>" + (v ? "<small>" + esc(money(v)) + "</small>" : "") + "</div></div>" +
          col.map((c) => '<article class="acard" draggable="true" data-acc="' + c.id + '" tabindex="0"><div class="nm">' + esc(c.nom) + '</div><div class="meta"><span>' + esc([c.secteur, c.ville].filter(Boolean).join(" · ")) + '</span><span class="money">' + esc(money(c.valeur)) + '</span></div><div class="meta"><span>' + esc(depuis(dernier(c.id))) + "</span>" + (c.prochaine_relance ? relanceHtml(c) : "") + "</div></article>").join("") + "</section>";
      }).join("") + "</div>";
  }
  let dragAcc = null;
  function initPipeDnD() {
    const v = $("#view");
    v.addEventListener("dragstart", (e) => { const c = e.target.closest(".acard"); if (!c) return; dragAcc = c.dataset.acc; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragAcc); } catch (_) {} });
    v.addEventListener("dragend", () => { dragAcc = null; $$(".acard.dragging").forEach((c) => c.classList.remove("dragging")); $$(".col.over").forEach((c) => c.classList.remove("over")); });
    v.addEventListener("dragover", (e) => { const col = e.target.closest(".col[data-stage]"); if (!col || !dragAcc) return; e.preventDefault(); $$(".col.over").forEach((c) => c !== col && c.classList.remove("over")); col.classList.add("over"); });
    v.addEventListener("drop", (e) => {
      const col = e.target.closest(".col[data-stage]"); if (!col || !dragAcc) return; e.preventDefault();
      const c = compte(dragAcc); if (c && c.etape !== col.dataset.stage) { majCompte(c, { etape: col.dataset.stage }); toast(c.nom + " → " + LBL(ETAPES, col.dataset.stage)); }
    });
  }

  // ───────────────────────── clients ─────────────────────────
  function renderClients() {
    const k = S.sort.k, dir = S.sort.asc ? 1 : -1;
    const cmp = { nom: (a, b) => a.nom.localeCompare(b.nom, "fr"), etape: (a, b) => ETAPES.findIndex((x) => x[0] === a.etape) - ETAPES.findIndex((x) => x[0] === b.etape), dernier: (a, b) => (dernier(a.id) || "").localeCompare(dernier(b.id) || ""), relance: (a, b) => (a.prochaine_relance || "9999").localeCompare(b.prochaine_relance || "9999"), valeur: (a, b) => (Number(a.valeur) || 0) - (Number(b.valeur) || 0) }[k];
    const l = S.comptes.filter((c) => trouve(c) && (!S.fEtape || c.etape === S.fEtape)).sort((a, b) => dir * cmp(a, b) || a.nom.localeCompare(b.nom, "fr"));
    const th = (key, lab) => '<th data-sort="' + key + '" class="' + (k === key ? "on" + (S.sort.asc ? " asc" : "") : "") + '">' + lab + "</th>";
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Clients</h1><p class="sub">' + S.comptes.length + " client" + (S.comptes.length > 1 ? "s" : "") + " et prospects</p></div>" +
      '<div class="actions"><button class="btn" type="button" data-act="csv"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>Exporter</button><button class="btn black" type="button" data-act="new-acc"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nouveau client</button></div></div>' +
      '<div class="chips" style="margin-bottom:14px"><button type="button" data-etape="" class="' + (!S.fEtape ? "on" : "") + '">Tous</button>' + ETAPES.map(([e, lab]) => '<button type="button" data-etape="' + e + '" class="' + (S.fEtape === e ? "on" : "") + '">' + lab + " · " + S.comptes.filter((c) => c.etape === e).length + "</button>").join("") + "</div>" +
      (l.length ? '<div class="table-wrap"><table class="tasks"><thead><tr>' + th("nom", "Client") + th("etape", "Étape") + "<th>Contact principal</th>" + th("dernier", "Dernier contact") + th("relance", "Relance") + th("valeur", "Valeur") + "</tr></thead><tbody>" +
        l.map((c) => { const ct = contactsDe(c.id)[0]; return '<tr data-open="' + c.id + '"><td class="t">' + esc(c.nom) + '<span class="sm">' + esc([c.secteur, c.ville].filter(Boolean).join(" · ")) + "</span></td><td>" + stage(c.etape) + "</td><td>" + (ct ? esc(ct.nom) + '<span class="sm">' + esc(ct.poste || ct.courriel || "") + "</span>" : '<span class="due">—</span>') + "</td><td>" + esc(depuis(dernier(c.id))) + "</td><td>" + relanceHtml(c) + '</td><td class="money">' + esc(money(c.valeur)) + "</td></tr>"; }).join("") + "</tbody></table></div>"
        : '<div class="card empty-state">' + (S.comptes.length ? "Aucun client ne correspond." : "Aucun client pour l’instant.") + '<br><button class="btn black" type="button" data-act="log">Logger un contact</button></div>');
  }
  function exportCsv() {
    const cols = ["Client", "Étape", "Secteur", "Ville", "Site web", "Téléphone", "Valeur", "Source", "Responsable", "Contact principal", "Poste", "Courriel", "Dernier contact", "Prochaine relance", "Note de relance", "Notes"];
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const rows = S.comptes.map((c) => { const ct = contactsDe(c.id)[0] || {}, d = dernier(c.id); return [c.nom, LBL(ETAPES, c.etape), c.secteur, c.ville, c.site_web, c.telephone, c.valeur, c.source, c.responsable, ct.nom, ct.poste, ct.courriel, d ? iso(new Date(d)) : "", c.prochaine_relance, c.relance_note, c.notes].map(q).join(";"); });
    const blob = new Blob(["﻿" + cols.map(q).join(";") + "\r\n" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "clients-groupe-lounici-" + today() + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ───────────────────────── journal ─────────────────────────
  function renderJournal() {
    const l = S.activites.filter((a) => (!S.fType || a.type === S.fType) && (!S.q || [a.sujet, a.notes, a.resultat, (compte(a.compte_id) || {}).nom, (contact(a.contact_id) || {}).nom].join(" ").toLowerCase().includes(S.q)));
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Journal des échanges</h1><p class="sub">' + l.length + " échange" + (l.length > 1 ? "s" : "") + "</p></div></div>" +
      '<div class="chips" style="margin-bottom:14px"><button type="button" data-type="" class="' + (!S.fType ? "on" : "") + '">Tous</button>' + TYPES.map(([t, lab]) => '<button type="button" data-type="' + t + '" class="' + (S.fType === t ? "on" : "") + '">' + lab + "</button>").join("") + "</div>" +
      '<section class="card">' + feed(l.slice(0, 400), true, true) + "</section>";
  }

  // ───────────────────────── recherche ─────────────────────────
  function renderSearch() {
    const cs = S.comptes.filter(trouve), as = S.activites.filter((a) => [a.sujet, a.notes, a.resultat].join(" ").toLowerCase().includes(S.q));
    $("#view").innerHTML = '<div class="page-head"><div><h1 class="title">Recherche</h1><p class="sub">« ' + esc(S.q) + " »</p></div></div>" +
      '<section class="card"><h2>Clients <small>' + cs.length + "</small></h2>" + (cs.length ? '<div class="dl">' + cs.map((c) => '<button type="button" data-open="' + c.id + '"><span class="avatar">' + esc(initials(c.nom)) + '</span><span class="t">' + esc(c.nom) + "<small>" + esc(contactsDe(c.id).map((x) => x.nom).join(", ")) + "</small></span>" + stage(c.etape) + "</button>").join("") + "</div>" : '<div class="empty-state">Aucun client.</div>') + "</section>" +
      '<section class="card" style="margin-top:14px"><h2>Échanges <small>' + as.length + "</small></h2>" + feed(as.slice(0, 100), true, false) + "</section>";
  }

  // ───────────────────────── fiche client ─────────────────────────
  function renderClient() {
    const c = compte(S.route.id), cts = contactsDe(c.id), acts = activitesDe(c.id), st = relanceEtat(c);
    const kv = [["Secteur", esc(c.secteur)], ["Ville", esc(c.ville)], ["Site web", c.site_web ? '<a href="' + esc(lien(c.site_web)) + '" target="_blank" rel="noopener">' + esc(c.site_web.replace(/^https?:\/\//, "")) + "</a>" : ""], ["Téléphone", c.telephone ? '<a href="tel:' + esc(c.telephone) + '">' + esc(c.telephone) + "</a>" : ""], ["Valeur", esc(money(c.valeur))], ["Source", esc(c.source)], ["Responsable", esc(c.responsable)], ["Dernier contact", esc(depuis(dernier(c.id)))], ["Créé le", esc(fmtD(c.cree_le))]].filter((x) => x[1]);
    $("#view").innerHTML =
      '<div class="proj-head"><div class="row"><div class="ttl"><h1 class="title">' + esc(c.nom) + '</h1><select id="acc-stage" class="stage e-' + c.etape + '" aria-label="Étape" style="border:0;cursor:pointer;appearance:none;padding-right:12px">' + ETAPES.map(([k, l]) => '<option value="' + k + '"' + (k === c.etape ? " selected" : "") + ">" + l + "</option>").join("") + "</select></div>" +
        '<div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn black" type="button" data-log="' + c.id + '"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Logger un échange</button><button class="btn" type="button" data-act="edit-acc">Modifier</button><button class="btn danger" type="button" data-act="del-acc">Supprimer</button></div></div>' +
        (c.notes ? '<p class="proj-desc">' + esc(c.notes) + "</p>" : "") + "</div>" +
      '<div class="acc-grid"><section class="card"><h2>Échanges <small>' + acts.length + "</small></h2>" + (acts.length ? feed(acts, false, false) : '<div class="empty-state">Aucun échange avec ce client.<br><button class="btn black" type="button" data-log="' + c.id + '">Logger un échange</button></div>') + "</section>" +
        '<div class="acc-side"><div class="relance' + (!c.prochaine_relance ? " none" : st === "late" ? " late" : "") + '">' +
          (c.prochaine_relance ? "<small>Prochaine relance</small><b>" + (st === "late" ? "En retard · " : "") + esc(diffDays(today(), c.prochaine_relance) === 0 ? "Aujourd’hui" : fmtD(c.prochaine_relance)) + "</b>" + (c.relance_note ? "<span>" + esc(c.relance_note) + "</span>" : "") +
            '<div class="row"><button class="btn" type="button" data-snooze="' + c.id + '">Reporter d’une semaine</button><button class="btn" type="button" data-done="' + c.id + '">Fait</button><button class="btn" type="button" data-act="set-relance">Changer</button></div>'
          : '<small>Aucune relance prévue</small><div class="row"><button class="btn" type="button" data-relance="3">Dans 3 jours</button><button class="btn" type="button" data-relance="7">Dans 1 semaine</button><button class="btn" type="button" data-relance="30">Dans 1 mois</button><button class="btn" type="button" data-act="set-relance">Autre date</button></div>') +
        '</div><section class="card"><h2>Contacts <small><button class="btn ghost" type="button" data-act="new-ct" style="height:28px">+ Ajouter</button></small></h2><div class="contacts">' +
          (cts.length ? cts.map((x) => '<div class="ct"><span class="avatar">' + esc(initials(x.nom)) + '</span><div><span class="nm">' + esc(x.nom) + "</span><small>" + esc([x.poste, x.courriel, x.telephone].filter(Boolean).join(" · ")) + '</small></div><div class="acts">' +
            (x.courriel ? '<a href="mailto:' + esc(x.courriel) + '" title="Écrire">' + ICONS.courriel + "</a>" : "") + (x.telephone ? '<a href="tel:' + esc(x.telephone) + '" title="Appeler">' + ICONS.appel + "</a>" : "") + (x.linkedin ? '<a href="' + esc(lien(x.linkedin)) + '" target="_blank" rel="noopener" title="LinkedIn">' + ICONS.linkedin + "</a>" : "") +
            '<button type="button" data-edit-ct="' + x.id + '" title="Modifier"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button></div></div>').join("") : '<div class="empty-state" style="padding:12px">Aucun contact.</div>') +
        '</div></section><section class="card"><h2>Informations</h2><dl class="kv">' + kv.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("") + "</dl></section></div></div>";
  }

  // ───────────────────────── mises à jour ─────────────────────────
  function majCompte(c, patch) { Object.assign(c, patch); render(); return persist(() => Store.update("comptes", c.id, patch), "Modification impossible"); }
  function relance(c, date, note) { majCompte(c, { prochaine_relance: date || null, relance_note: date ? (note === undefined ? c.relance_note : note) || null : null }); }

  // ───────────────────────── fenêtre : logger un contact ─────────────────────────
  function logDialog(compteId) {
    const d = $("#log-dlg"), c0 = compteId ? compte(compteId) : null, now = new Date();
    d.className = "modal wide";
    d.innerHTML = '<form id="log-form" novalidate><h3>Logger un contact</h3><div class="fields">' +
      '<label class="fl full">Client<input name="client" list="accounts" required autocomplete="off" placeholder="Nom de l’entreprise ou de la personne" value="' + esc(c0 ? c0.nom : "") + '"></label>' +
      '<div class="new-acc" id="new-acc"><span class="hint full" style="grid-column:1/-1">Nouveau client : il sera créé avec cet échange.</span><label class="fl">Secteur<input name="secteur" list="sectors"></label><label class="fl">Ville<input name="ville"></label><label class="fl">Source<input name="source" list="sources" placeholder="Comment l’avez-vous trouvé ?"></label><label class="fl">Valeur estimée ($)<input name="valeur" type="number" min="0" step="500"></label></div>' +
      '<label class="fl">Personne contactée<input name="contact" list="acc-contacts" autocomplete="off" placeholder="Nom (facultatif)"><datalist id="acc-contacts"></datalist></label>' +
      '<label class="fl">Date et heure<input name="quand" type="datetime-local" value="' + localDT(now) + '"></label>' +
      '<div class="new-acc" id="new-ct"><span class="hint" style="grid-column:1/-1">Nouveau contact pour ce client.</span><label class="fl">Poste<input name="poste"></label><label class="fl">Courriel<input name="courriel" type="email"></label><label class="fl">Téléphone<input name="telephone" type="tel"></label><label class="fl">LinkedIn<input name="linkedin"></label></div>' +
      '<div class="fl full">Type d’échange<div class="types">' + TYPES.map(([k, l], i) => '<input type="radio" name="type" id="ty-' + k + '" value="' + k + '"' + (i === 0 ? " checked" : "") + '><label for="ty-' + k + '">' + ICONS[k].replace("<svg", '<svg width="15" height="15"') + l + "</label>").join("") + "</div></div>" +
      '<div class="fl full" id="sens-wrap">Sens<div><div class="seg"><input type="radio" name="sens" id="se-out" value="sortant" checked><label for="se-out">Je l’ai contacté</label><input type="radio" name="sens" id="se-in" value="entrant"><label for="se-in">Il m’a contacté</label></div></div></div>' +
      '<label class="fl full">Sujet<input name="sujet" placeholder="Ex. Présentation de l’offre diagnostic"></label>' +
      '<label class="fl full">Notes<textarea name="notes" placeholder="Ce qui a été dit, besoins, objections, prochaines étapes…"></textarea></label>' +
      '<label class="fl">Résultat<input name="resultat" list="resultats" placeholder="Ex. Intéressé"><datalist id="resultats">' + RESULTATS.map((r) => '<option value="' + esc(r) + '">').join("") + "</datalist></label>" +
      '<label class="fl">Étape du client<select name="etape">' + ETAPES.map(([k, l]) => '<option value="' + k + '">' + l + "</option>").join("") + "</select></label>" +
      '<div class="fl full">Prochaine relance<div class="chips" id="rel-quick">' + [["", "Aucune"], ["3", "Dans 3 jours"], ["7", "1 semaine"], ["14", "2 semaines"], ["30", "1 mois"]].map(([v, l]) => '<button type="button" data-days="' + v + '">' + l + "</button>").join("") + '</div><div class="fields" style="margin-top:8px"><input name="relance" type="date" aria-label="Date de relance" style="height:40px;padding:0 12px;border-radius:10px;border:1px solid transparent;background:var(--soft)"><input name="relance_note" placeholder="Pourquoi relancer ? (facultatif)" style="height:40px;padding:0 12px;border-radius:10px;border:1px solid transparent;background:var(--soft)"></div></div>' +
      '</div><p class="m-err" id="log-err" hidden></p><div class="m-foot"><button class="btn" type="button" data-m="cancel">Annuler</button><button class="btn black" type="submit">Enregistrer l’échange</button></div></form>';
    const f = $("#log-form"), I = (n) => f.elements[n];
    const courant = () => S.comptes.find((x) => x.nom.trim().toLowerCase() === I("client").value.trim().toLowerCase());
    const etapeAuto = () => {
      const c = courant(), ty = f.elements.type.value, rang = (e) => ETAPES.findIndex((x) => x[0] === e);
      let e = c ? c.etape : "contacte";
      if (e === "prospect" && ty !== "note") e = "contacte";
      if (ty === "rencontre" && rang(e) < rang("rencontre") && !["gagne", "perdu"].includes(e)) e = "rencontre";
      I("etape").value = e;
    };
    const majClient = () => {
      const c = courant(), nom = I("client").value.trim();
      $("#new-acc").classList.toggle("on", !!nom && !c);
      $("#acc-contacts").innerHTML = c ? contactsDe(c.id).map((x) => '<option value="' + esc(x.nom) + '">').join("") : "";
      // la personne remplie automatiquement suit le client : on la retire si le client change
      const ci = I("contact");
      if (ci.dataset.auto && !(c && contactsDe(c.id).some((x) => x.nom === ci.value))) { ci.value = ""; delete ci.dataset.auto; }
      if (c && !ci.value) { const cs = contactsDe(c.id); if (cs.length === 1) { ci.value = cs[0].nom; ci.dataset.auto = "1"; } }
      majContact(); etapeAuto();
    };
    const majContact = () => { const c = courant(), n = I("contact").value.trim(); $("#new-ct").classList.toggle("on", !!n && !(c && contactsDe(c.id).some((x) => x.nom.toLowerCase() === n.toLowerCase()))); };
    I("client").addEventListener("input", majClient); I("contact").addEventListener("input", () => { delete I("contact").dataset.auto; majContact(); });
    f.addEventListener("change", (e) => { if (e.target.name === "type") { etapeAuto(); $("#sens-wrap").hidden = e.target.value === "note"; } if (e.target.name === "relance") { I("relance").dataset.touched = "1"; $$("#rel-quick button").forEach((b) => b.classList.remove("on")); } });
    $("#rel-quick").addEventListener("click", (e) => { const b = e.target.closest("[data-days]"); if (!b) return; $$("#rel-quick button").forEach((x) => x.classList.toggle("on", x === b)); I("relance").value = b.dataset.days ? addDays(today(), +b.dataset.days) : ""; I("relance").dataset.touched = "1"; });
    $("[data-m=cancel]", d).onclick = () => d.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const nom = I("client").value.trim(), err = $("#log-err");
      if (!nom) { err.textContent = "Indiquez le client."; err.hidden = false; I("client").focus(); return; }
      const btn = $("button[type=submit]", f); btn.disabled = true;
      let c = courant();
      if (!c) {
        const row = { nom, secteur: I("secteur").value.trim() || null, ville: I("ville").value.trim() || null, source: I("source").value.trim() || null, valeur: I("valeur").value === "" ? null : Number(I("valeur").value), etape: I("etape").value, responsable: (S.me && S.me.nom) || null };
        c = await persist(() => Store.insert("comptes", row), "Création du client impossible"); if (!c) { btn.disabled = false; return; }
        S.comptes.push(c);
      }
      let ctId = null; const cn = I("contact").value.trim();
      if (cn) {
        let ct = contactsDe(c.id).find((x) => x.nom.toLowerCase() === cn.toLowerCase());
        if (!ct) {
          const row = { compte_id: c.id, nom: cn, poste: I("poste").value.trim() || null, courriel: I("courriel").value.trim() || null, telephone: I("telephone").value.trim() || null, linkedin: I("linkedin").value.trim() || null };
          ct = await persist(() => Store.insert("contacts", row), "Création du contact impossible"); if (ct) S.contacts.push(ct);
        }
        ctId = ct ? ct.id : null;
      }
      const ty = f.elements.type.value, q = I("quand").value ? new Date(I("quand").value) : new Date();
      const act = { compte_id: c.id, contact_id: ctId, type: ty, sens: ty === "note" ? "sortant" : f.elements.sens.value, quand: q.toISOString(), sujet: I("sujet").value.trim() || null, notes: I("notes").value.trim() || null, resultat: I("resultat").value.trim() || null };
      const a = await persist(() => Store.insert("activites", act), "Enregistrement de l’échange impossible");
      if (a) { S.activites.push(a); trierActivites(); }
      const patch = {};
      if (I("etape").value !== c.etape) patch.etape = I("etape").value;
      if (I("relance").dataset.touched) { patch.prochaine_relance = I("relance").value || null; patch.relance_note = I("relance").value ? I("relance_note").value.trim() || null : null; }
      else if (c.prochaine_relance && c.prochaine_relance <= today() && ty !== "note") { patch.prochaine_relance = null; patch.relance_note = null; }   // relance due accomplie par cet échange
      if (Object.keys(patch).length) await majCompte(c, patch);
      d.close(); btn.disabled = false;
      toast("Échange enregistré" + (patch.prochaine_relance ? " · relance le " + fmtD(patch.prochaine_relance) : ""));
      if (S.route.v === "client" && S.route.id === c.id) render(); else location.hash = "client/" + c.id;
    };
    d.showModal(); majClient();
    (c0 ? I("contact") : I("client")).focus();
  }

  // ───────────────────────── fenêtres : client, contact, relance, confirmation ─────────────────────────
  function accDialog(c) {
    const d = $("#acc-dlg"); d.className = "modal wide";
    const v = (k) => esc(c ? c[k] == null ? "" : c[k] : "");
    d.innerHTML = '<form id="acc-form"><h3>' + (c ? "Modifier le client" : "Nouveau client") + '</h3><div class="fields">' +
      '<label class="fl full">Nom<input name="nom" required value="' + v("nom") + '"></label>' +
      '<label class="fl">Secteur<input name="secteur" list="sectors" value="' + v("secteur") + '"></label><label class="fl">Ville<input name="ville" value="' + v("ville") + '"></label>' +
      '<label class="fl">Site web<input name="site_web" value="' + v("site_web") + '" placeholder="exemple.com"></label><label class="fl">Téléphone<input name="telephone" type="tel" value="' + v("telephone") + '"></label>' +
      '<label class="fl">Étape<select name="etape">' + ETAPES.map(([k, l]) => '<option value="' + k + '"' + ((c ? c.etape : "prospect") === k ? " selected" : "") + ">" + l + "</option>").join("") + '</select></label><label class="fl">Valeur estimée ($)<input name="valeur" type="number" min="0" step="500" value="' + v("valeur") + '"></label>' +
      '<label class="fl">Source<input name="source" list="sources" value="' + v("source") + '"></label><label class="fl">Responsable<input name="responsable" value="' + (c ? v("responsable") : esc((S.me && S.me.nom) || "")) + '"></label>' +
      '<label class="fl full">Notes<textarea name="notes">' + v("notes") + "</textarea></label></div>" +
      '<p class="m-err" id="acc-err" hidden></p><div class="m-foot"><button class="btn" type="button" data-m="cancel">Annuler</button><button class="btn black" type="submit">' + (c ? "Enregistrer" : "Créer le client") + "</button></div></form>";
    d.showModal(); $("[data-m=cancel]", d).onclick = () => d.close();
    $("#acc-form").onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target), row = {};
      ["nom", "secteur", "ville", "site_web", "telephone", "etape", "source", "responsable", "notes"].forEach((k) => { row[k] = String(f.get(k) || "").trim() || null; });
      row.valeur = f.get("valeur") === "" ? null : Number(f.get("valeur"));
      if (!row.nom) return;
      const dup = S.comptes.find((x) => x.nom.trim().toLowerCase() === row.nom.toLowerCase() && (!c || x.id !== c.id));
      if (dup) { const er = $("#acc-err"); er.textContent = "Un client porte déjà ce nom."; er.hidden = false; return; }
      d.close();
      if (c) { await majCompte(c, row); toast("Client enregistré"); }
      else { const r = await persist(() => Store.insert("comptes", row), "Création du client impossible"); if (r) { S.comptes.push(r); location.hash = "client/" + r.id; toast("Client « " + r.nom + " » créé"); } }
    };
  }
  function ctDialog(compteId, ct) {
    const d = $("#ct-dlg"), v = (k) => esc(ct ? ct[k] || "" : "");
    d.innerHTML = '<form id="ct-form"><h3>' + (ct ? "Modifier le contact" : "Nouveau contact") + '</h3><div class="fields">' +
      '<label class="fl">Nom<input name="nom" required value="' + v("nom") + '"></label><label class="fl">Poste<input name="poste" value="' + v("poste") + '"></label>' +
      '<label class="fl">Courriel<input name="courriel" type="email" value="' + v("courriel") + '"></label><label class="fl">Téléphone<input name="telephone" type="tel" value="' + v("telephone") + '"></label>' +
      '<label class="fl full">LinkedIn<input name="linkedin" value="' + v("linkedin") + '" placeholder="linkedin.com/in/…"></label><label class="fl full">Notes<textarea name="notes">' + v("notes") + "</textarea></label></div>" +
      '<div class="m-foot">' + (ct ? '<button class="btn danger" type="button" data-m="del" style="margin-right:auto">Supprimer</button>' : "") + '<button class="btn" type="button" data-m="cancel">Annuler</button><button class="btn black" type="submit">Enregistrer</button></div></form>';
    d.showModal(); $("[data-m=cancel]", d).onclick = () => d.close();
    const del = $("[data-m=del]", d); if (del) del.onclick = () => { d.close(); confirmer("Supprimer le contact ?", "« " + ct.nom + " » sera retiré ; ses échanges restent dans le journal du client.", "Supprimer").then((ok) => { if (!ok) return; S.contacts = S.contacts.filter((x) => x.id !== ct.id); S.activites.forEach((a) => { if (a.contact_id === ct.id) a.contact_id = null; }); render(); persist(() => Store.remove("contacts", ct.id), "Suppression impossible"); }); };
    $("#ct-form").onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target), row = {};
      ["nom", "poste", "courriel", "telephone", "linkedin", "notes"].forEach((k) => { row[k] = String(f.get(k) || "").trim() || null; });
      if (!row.nom) return; d.close();
      if (ct) { Object.assign(ct, row); render(); await persist(() => Store.update("contacts", ct.id, row), "Modification impossible"); }
      else { row.compte_id = compteId; const r = await persist(() => Store.insert("contacts", row), "Création du contact impossible"); if (r) { S.contacts.push(r); render(); } }
    };
  }
  function relanceDialog(c) {
    const d = $("#confirm-dlg");
    d.innerHTML = '<form class="m-in" id="rel-form"><h3>Prochaine relance</h3><div class="fields"><label class="fl">Date<input type="date" name="date" required value="' + esc(c.prochaine_relance || addDays(today(), 7)) + '"></label><label class="fl">Note<input name="note" value="' + esc(c.relance_note || "") + '" placeholder="Pourquoi relancer ?"></label></div><div class="m-foot"><button class="btn" type="button" data-m="cancel">Annuler</button><button class="btn black" type="submit">Enregistrer</button></div></form>';
    d.onclick = null; d.onclose = null; d.showModal(); $("[data-m=cancel]", d).onclick = () => d.close();
    $("#rel-form").onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); d.close(); relance(c, String(f.get("date")), String(f.get("note") || "").trim()); toast("Relance le " + fmtD(String(f.get("date")))); };
  }
  function confirmer(titre, texte, bouton) {
    return new Promise((res) => {
      const d = $("#confirm-dlg");
      d.innerHTML = '<div class="m-in"><h3>' + esc(titre) + "</h3><p>" + esc(texte) + '</p><div class="m-foot"><button class="btn" type="button" data-c="0">Annuler</button><button class="btn black" type="button" data-c="1">' + esc(bouton) + "</button></div></div>";
      let v = false; d.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) { v = b.dataset.c === "1"; d.close(); } else if (e.target === d) d.close(); };
      d.onclose = () => { d.onclose = null; d.onclick = null; res(v); }; d.showModal();
    });
  }

  // ───────────────────────── événements du contenu ─────────────────────────
  function initView() {
    const v = $("#view");
    v.addEventListener("click", (e) => {
      const el = (s) => e.target.closest(s);
      let b;
      if ((b = el("[data-log]"))) { e.stopPropagation(); return logDialog(b.dataset.log); }
      if ((b = el("[data-snooze]"))) { e.stopPropagation(); const c = compte(b.dataset.snooze); const base = c.prochaine_relance && c.prochaine_relance > today() ? c.prochaine_relance : today(); relance(c, addDays(base, 7)); return toast("Relance reportée au " + fmtD(addDays(base, 7))); }
      if ((b = el("[data-done]"))) { e.stopPropagation(); relance(compte(b.dataset.done), null); return toast("Relance retirée"); }
      if ((b = el("[data-relance]"))) { const c = compte(S.route.id); relance(c, addDays(today(), +b.dataset.relance), ""); return toast("Relance le " + fmtD(addDays(today(), +b.dataset.relance))); }
      if ((b = el("[data-del-act]"))) { const a = S.activites.find((x) => x.id === b.dataset.delAct); return confirmer("Supprimer cet échange ?", "Il sera retiré du journal.", "Supprimer").then((ok) => { if (!ok) return; S.activites = S.activites.filter((x) => x.id !== a.id); render(); persist(() => Store.remove("activites", a.id), "Suppression impossible"); }); }
      if ((b = el("[data-edit-ct]"))) return ctDialog(S.route.id, contact(b.dataset.editCt));
      if ((b = el("[data-etape]"))) { S.fEtape = b.dataset.etape; return render(); }
      if ((b = el("[data-type]"))) { S.fType = b.dataset.type; return render(); }
      if ((b = el("[data-sort]"))) { S.sort = { k: b.dataset.sort, asc: S.sort.k === b.dataset.sort ? !S.sort.asc : b.dataset.sort === "nom" || b.dataset.sort === "relance" }; return render(); }
      if ((b = el("[data-goto]"))) { location.hash = b.dataset.goto; return; }
      if ((b = el("[data-act]"))) {
        const a = b.dataset.act, c = compte(S.route.id);
        if (a === "log") logDialog(null);
        if (a === "new-acc") accDialog(null);
        if (a === "csv") exportCsv();
        if (a === "edit-acc" && c) accDialog(c);
        if (a === "new-ct" && c) ctDialog(c.id, null);
        if (a === "set-relance" && c) relanceDialog(c);
        if (a === "del-acc" && c) confirmer("Supprimer le client ?", "« " + c.nom + " », ses " + contactsDe(c.id).length + " contacts et ses " + activitesDe(c.id).length + " échanges seront supprimés définitivement.", "Supprimer").then((ok) => {
          if (!ok) return; S.comptes = S.comptes.filter((x) => x.id !== c.id); S.contacts = S.contacts.filter((x) => x.compte_id !== c.id); S.activites = S.activites.filter((x) => x.compte_id !== c.id);
          location.hash = "clients"; persist(() => Store.remove("comptes", c.id), "Suppression impossible"); toast("Client supprimé");
        });
        return;
      }
      if (el("a")) return;
      if ((b = el("[data-open]")) || (b = el("[data-acc]"))) location.hash = "client/" + (b.dataset.open || b.dataset.acc);
    });
    v.addEventListener("keydown", (e) => { const c = e.target.closest(".acard"); if (c && e.key === "Enter") location.hash = "client/" + c.dataset.acc; });
    v.addEventListener("change", (e) => { if (e.target.id === "acc-stage") { const c = compte(S.route.id); majCompte(c, { etape: e.target.value }); toast(c.nom + " → " + LBL(ETAPES, e.target.value)); } });
  }

  // ───────────────────────── démarrage ─────────────────────────
  async function reload() {
    try { await Store.load(); trierActivites(); S.loadedAt = Date.now(); }
    catch (e) { if (tableManquante(e)) return setup(); console.error(e); toast("Lecture impossible : " + (e.message || e), false); }
    if (S.route.v === "client" && !compte(S.route.id)) location.hash = "clients";
    render();
  }
  function setup() {
    $("#view").innerHTML = '<div class="card setup"><h1 class="title">Une dernière étape</h1><p class="sub">La base en ligne n’a pas encore les tables du CRM.</p><ol>' +
      "<li>Ouvrez Supabase → projet « Lens Diagnostic » → <b>SQL Editor</b>.</li><li>Collez le contenu du fichier <code>supabase/crm.sql</code> du dépôt <code>groupe-lounici-erp</code>, puis <b>Run</b>.</li><li>Rechargez cette page.</li></ol></div>";
    $("#log-btn").disabled = true;
  }
  function bloque(titre, texte, lienConnexion) {
    $("#view").innerHTML = '<div class="card setup"><h1 class="title">' + esc(titre) + '</h1><p class="sub">' + esc(texte) + '</p><p style="margin-top:16px"><a class="btn black" href="' + (lienConnexion ? "index.html" : "portail.html") + '">' + (lienConnexion ? "Se connecter" : "Retour au portail") + "</a></p></div>";
    $("#log-btn").hidden = true; $(".search").hidden = true;
  }

  async function start() {
    $("#side-scrim").onclick = $("#side-close").onclick = () => $("#app").classList.remove("menu");
    $("#menu-btn").onclick = () => $("#app").classList.add("menu");
    $("#log-btn").onclick = () => logDialog(S.route.v === "client" ? S.route.id : null);
    let qt; $("#search").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 150); });
    initView(); initPipeDnD();
    window.addEventListener("hashchange", route);
    // raccourci : N = logger un contact (hors champs de saisie)
    document.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector("dialog[open]") && !$("#log-btn").disabled && !$("#log-btn").hidden) { e.preventDefault(); $("#log-btn").click(); } });

    if (S.cloud) {
      try { S.me = await LensCloud.me(); } catch (e) { console.error(e); }
      if (!S.me) { try { sessionStorage.removeItem("portail"); } catch (_) {} return bloque("Session expirée", "Reconnectez-vous pour accéder au CRM.", true); }
      if (S.me.role !== "lounici") return bloque("Accès réservé", "Le CRM est réservé à l’équipe de Groupe Lounici.", false);
      $("#who").textContent = (S.me.nom || S.me.email || "") + " · Groupe Lounici";
    } else { S.me = { nom: "Moi" }; $("#who").textContent = "Mode local · ce navigateur"; }

    sync(0);
    await reload(); route();
    window.addEventListener("focus", () => { if (Date.now() - S.loadedAt > 30000 && !document.querySelector("dialog[open]")) reload(); });
  }
  start();
})();
