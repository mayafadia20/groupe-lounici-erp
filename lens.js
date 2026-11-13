// Lens — logique de l'application
// Les données vivent dans localStorage sous la clé « lens.data » (copie de travail) et, quand lens-config.js est
// rempli, dans la base en ligne (table « espaces », un document par entreprise) : chargement au démarrage,
// sauvegarde à chaque modification. Les vidéos d'enregistrement partent dans le bucket « enregistrements ».
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const KEY = "lens.data";

  // ───────────────────────── données par défaut (celles de la démonstration) ─────────────────────────
  // Aucune donnée de départ : l'espace se remplit avec ce que l'entreprise enregistre.
  const DEF = {
    company: { name: "", sector: "Construction", size: "", email: "", first: "", day: 8 },
    departments: [], users: [], extraInvited: 0,
    v: 3,   // version des données : v3 = plus aucune donnée de démonstration
    objForm: { cat: "Financier", depts: [], inds: {} }, objectives: [], indicators: [],
    task: { name: "", dept: "", proc: "Nouveau processus", freq: "", windows: [] },
    rec: null, processes: [], activeProc: 0, procValidated: false, steps: [],
    fiche: {}, ficheSaved: false,
    epc: null,   // ancien emplacement du diagramme importé (désormais dans chaque processus)
    projects: [], realOverrides: {}, period: "T4 2026", chartMode: "monthly", sysMode: "usage", dashObj: 0,
  };
  // Gabarit « Construction » proposé par le bouton de l'étape Départements (8 départements types)
  const GABARIT = [
    { name: "Direction", resp: "", parent: "", n: 0 }, { name: "Opérations", resp: "", parent: "Direction", n: 0 },
    { name: "Estimation", resp: "", parent: "Opérations", n: 0 }, { name: "Approvisionnement", resp: "", parent: "Opérations", n: 0 },
    { name: "Finance", resp: "", parent: "Direction", n: 0 }, { name: "Ressources humaines", resp: "", parent: "Finance", n: 0 },
    { name: "Technologies", resp: "", parent: "Finance", n: 0 }, { name: "Ventes", resp: "", parent: "Direction", n: 0 }];
  let D = load();
  const CLOUD = !!(window.LensCloud && LensCloud.enabled);
  let ME = null;            // profil en ligne : { user_id, entreprise_id, role, nom, email, entreprises: { nom } }
  let cloudTimer = null, cloudDirty = false;
  function cloudSave() {
    if (!CLOUD || !ME || !ME.entreprise_id) return;
    cloudDirty = true; clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => { cloudDirty = false; LensCloud.saveSpace(ME.entreprise_id, D).catch((e) => { cloudDirty = true; console.error(e); toast("Sauvegarde en ligne impossible : " + e.message, false); }); }, 600);
  }
  function load() {
    try { const s = localStorage.getItem(KEY); if (s) { const saved = JSON.parse(s);
      if ((saved.v || 1) < 3 && saved.company && saved.company.name === "Construction Boréal inc.") return JSON.parse(JSON.stringify(DEF));   // ancienne démonstration : on repart à vide
      if ((saved.v || 1) < 2) { delete saved.objectives; delete saved.objForm; delete saved.indicators; }
      saved.v = 3;
      return normalize(Object.assign(JSON.parse(JSON.stringify(DEF)), saved)); } } catch (_) {}
    return JSON.parse(JSON.stringify(DEF));
  }
  // un diagramme importé (clé « epc » à la racine, ancien format) est rattaché au premier processus
  function normalize(d) {
    if (d.epc && d.processes[0] && !d.processes[0].epc) d.processes[0].epc = d.epc; d.epc = null;
    // chaque diagnostic porte son propre diagramme ; un ancien diagramme de processus est rattaché au dernier diagnostic (ou en crée un)
    (d.processes || []).forEach((p) => {
      p.diagnostics = Array.isArray(p.diagnostics) ? p.diagnostics : [];
      if (p.epc && !p.diagnostics.some((x) => x.epc)) { if (p.diagnostics.length) p.diagnostics[p.diagnostics.length - 1].epc = p.epc; else p.diagnostics.push({ name: "Diagnostic 1", desc: "", date: (p.epc.source || {}).date || new Date().toISOString(), epc: p.epc }); }
      p.epc = null;
    });
    return d;
  }
  /** Supprime en ligne les documents d'un processus (ils sont rattachés par son nom). */
  async function purgeProcessDocs(p) {
    if (!CLOUD || !ME || !ME.entreprise_id || !p) return 0;
    try { const rows = await LensCloud.listDocuments(ME.entreprise_id, p.title); for (const r of rows) { try { await LensCloud.deleteDocument(r.id, r.fichier); } catch (e) { console.warn(e); } } return rows.length; }
    catch (e) { console.warn(e); return 0; }
  }
  let DIAG_SEL = {};   // par processus (titre) : index du diagnostic affiché
  const procDiags = (p) => ((p || {}).diagnostics) || [];
  function selectedDiag(p) { const ds = procDiags(p); if (!ds.length) return null; let i = DIAG_SEL[p.title]; if (i == null || !ds[i]) { i = ds.length - 1; while (i > 0 && !ds[i].epc) i--; } return ds[i] || null; }
  const latestEpc = (p) => { const ds = procDiags(p); for (let i = ds.length - 1; i >= 0; i--) if (ds[i].epc) return ds[i].epc; return null; };
  const activeProc = () => D.processes[D.activeProc] || null;
  const activeEpc = () => { const d = selectedDiag(activeProc()); return d ? d.epc || null : null; };
  /** Nom du prochain diagnostic d'un processus : « Diagnostic 1 », « Diagnostic 2 »… (numérotation par le système). */
  const nextDiagName = (p) => "Diagnostic " + ((((p || {}).diagnostics) || []).length + 1);
  const diagDesc = (p) => (D.task.proc === (p || {}).title ? (D.task.desc || "") : "");
  function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (_) {} cloudSave(); }
  const deptNames = () => D.departments.map((d) => d.name);
  /** Nom canonique d'un département ; le crée (sans responsable ni effectif) s'il n'existe pas encore. */
  function ensureDept(name) {
    const n = String(name || "").trim(); if (!n) return "";
    const found = D.departments.find((d) => d.name.toLowerCase() === n.toLowerCase()); if (found) return found.name;
    D.departments.push({ name: n, resp: "", parent: "", n: 0 }); save(); if ($("#dep-rows")) renderDepts(); toast("Département « " + n + " » créé"); return n;
  }
  const totalEmployees = () => D.departments.reduce((a, d) => a + (Number(d.n) || 0), 0);
  const initials = (n) => n.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  const mmss = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  const num = (v) => parseFloat(String(v).replace(",", ".").replace(/[^\d.\-]/g, "")) || 0;
  const fr = (v, d) => v.toLocaleString("fr-CA", { maximumFractionDigits: d == null ? 1 : d });

  // ───────────────────────── messages, dialogues, téléchargements ─────────────────────────
  function toast(msg, dark) {
    const box = $("#toasts"); if (!box) return;
    const t = document.createElement("div");
    t.style.cssText = "max-width: 360px; padding: 12px 16px; border-radius: 14px; font-size: 13.5px; line-height: 1.4; box-shadow: 0 18px 40px -16px rgba(0,0,0,.45); " + (dark === false ? "background:#fff;color:#111113;border:1.5px solid #dcdce0" : "background:#111113;color:#fff");
    t.textContent = msg; box.appendChild(t);
    setTimeout(() => { t.style.transition = "opacity .4s"; t.style.opacity = "0"; setTimeout(() => t.remove(), 420); }, 3200);
  }
  const INPUT = "height: 44px; box-sizing: border-box; border-radius: 12px; border: 1.5px solid #dcdce0; padding: 0 12px; font: inherit; font-size: 14px; color: #111113; width: 100%; background: #fff";
  function dialog(o) {
    return new Promise((resolve) => {
      const dlg = $("#dlg"); if (!dlg || typeof dlg.showModal !== "function") { resolve(null); return; }
      $("#dlg-title").textContent = o.title || ""; $("#dlg-text").textContent = o.text || ""; $("#dlg-ok").textContent = o.ok || "Confirmer";
      const box = $("#dlg-fields"); box.innerHTML = "";
      (o.fields || []).forEach((f) => {
        const lab = document.createElement("label"); lab.style.cssText = "display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600";
        lab.appendChild(document.createTextNode(f.label));
        let el, wrap = null;
        if (f.combo) {
          wrap = document.createElement("div"); wrap.style.cssText = "display: flex; flex-direction: column; gap: 4px";
          el = document.createElement("input"); el.type = "text"; el.value = f.value || ""; el.placeholder = f.placeholder || ""; el.autocomplete = "off";
          const list = document.createElement("div"); list.style.cssText = "display: none; flex-direction: column; gap: 2px; max-height: 190px; overflow: auto; padding: 4px; border: 1.5px solid #dcdce0; border-radius: 12px; background: #fff";
          const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
          const item = (txt, label, strong) => '<button type="button" data-pick="' + esc(txt) + '" style="text-align: left; border: none; background: transparent; border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 14px; font-weight: ' + (strong ? 600 : 400) + '; cursor: pointer">' + label + "</button>";
          const render = () => { const q = norm(el.value); const opts = f.combo.filter((o) => !q || norm(o).includes(q)); const exact = f.combo.some((o) => norm(o) === q);
            const items = opts.map((o) => item(o, esc(o), false)); if (q && !exact) items.push(item(el.value.trim(), (f.createLabel || "Créer") + " « " + esc(el.value.trim()) + " »", true));
            list.innerHTML = items.join(""); list.style.display = items.length ? "flex" : "none"; };
          el.addEventListener("input", render); el.addEventListener("focus", render);
          list.addEventListener("mousedown", (e) => { const b = e.target.closest("[data-pick]"); if (!b) return; e.preventDefault(); el.value = b.dataset.pick; list.style.display = "none"; });
          list.addEventListener("click", (e) => e.preventDefault());
          el.addEventListener("blur", () => setTimeout(() => { list.style.display = "none"; }, 150));
          wrap.appendChild(el); wrap.appendChild(list);
        }
        else if (f.options) { el = document.createElement("select"); f.options.forEach((v) => { const op = document.createElement("option"); op.textContent = v; el.appendChild(op); }); if (f.value) el.value = f.value; }
        else if (f.type === "textarea") { el = document.createElement("textarea"); el.rows = 3; el.value = f.value || ""; if (f.placeholder) el.placeholder = f.placeholder; }
        else { el = document.createElement("input"); el.type = f.type || "text"; el.value = f.value || ""; if (f.placeholder) el.placeholder = f.placeholder; }
        el.name = f.name; el.style.cssText = INPUT + (f.type === "textarea" ? "; height: auto; padding: 10px 12px; resize: vertical" : ""); el.style.fontWeight = "400";
        lab.appendChild(wrap || el); box.appendChild(lab);
      });
      const form = $("#dlg-form");
      const done = (v) => { dlg.close(); form.onsubmit = null; $("#dlg-cancel").onclick = null; resolve(v); };
      form.onsubmit = (e) => { e.preventDefault(); const out = {}; new FormData(form).forEach((v, k) => (out[k] = String(v).trim())); done(out); };
      $("#dlg-cancel").onclick = () => done(null);
      dlg.oncancel = (e) => { e.preventDefault(); done(null); };
      dlg.showModal(); const first = box.querySelector("input, select, textarea"); if (first) first.focus();
    });
  }
  function download(name, content, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: type || "text/plain;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function pickFile(accept) { return new Promise((resolve) => { const f = $("#file-in"); f.accept = accept || ""; f.value = ""; f.onchange = () => { const file = f.files[0]; if (!file) return resolve(null); const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsText(file); }; f.click(); }); }
  function parseCSV(text) { return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""))); }

  // ───────────────────────── écran 1 : connexion ─────────────────────────
  function initConnexion() {
    const f = { name: $("#co-name"), sector: $("#co-sector"), size: $("#co-size"), email: $("#co-email"), pass: $("#co-pass"), pass2: $("#co-pass2") };
    if (!f.name) return;
    const views = $$("#connexion [data-cv]");
    const show = (v) => { views.forEach((el) => { el.style.display = el.dataset.cv === v ? "flex" : "none"; }); const first = views.find((el) => el.dataset.cv === v); const inp = first && first.querySelector("input"); if (inp) setTimeout(() => inp.focus(), 50); };
    const err = (id, m) => { const el = $(id); if (!el) return; el.textContent = m || ""; el.style.display = m ? "block" : "none"; };
    // accueil : avec une session en ligne, « Se connecter » devient « Continuer »
    const refreshAccueil = () => { const b = $("#cx-login"), sw = $("#cx-switch"); if (CLOUD && ME) { b.textContent = "Continuer · " + (ME.email || ""); sw.style.display = "inline"; } else { b.textContent = "Se connecter"; sw.style.display = "none"; } };
    refreshAccueil();
    const vue = new URLSearchParams(location.search).get("vue"); if (vue && views.some((el) => el.dataset.cv === vue)) show(vue);   // lens.html?vue=login ou ?vue=creer
    if (!CLOUD) { $$("#connexion [data-cloud-only]").forEach((el) => (el.style.display = "none")); f.name.value = D.company.name; f.sector.value = D.company.sector; f.size.value = D.company.size; f.email.value = D.company.email; }
    $("#cx-login").addEventListener("click", () => { if (CLOUD && ME) { location.hash = "tableau"; return; } if (!CLOUD) { location.hash = "tableau"; return; } show("login"); });
    $("#cx-signup").addEventListener("click", () => show("creer"));
    $("#cx-switch").addEventListener("click", async () => { await LensCloud.signOut(); ME = null; try { localStorage.removeItem(KEY); } catch (_) {} refreshAccueil(); show("login"); });
    $("#lg-back").addEventListener("click", () => show("accueil")); $("#co-back").addEventListener("click", () => show("accueil"));
    $("#lg-reset").addEventListener("click", async () => { const e = $("#lg-email").value.trim(); if (!/.+@.+\..+/.test(e)) { err("#lg-err", "Entrez d’abord votre courriel, puis cliquez de nouveau."); return; } try { await LensCloud.resetPassword(e, location.origin + location.pathname); err("#lg-err", ""); toast("Courriel envoyé à " + e + " : suivez le lien pour choisir un nouveau mot de passe."); } catch (ex) { err("#lg-err", ex.message); } });
    // connexion
    $('#connexion [data-cv="login"]').addEventListener("submit", async (e) => {
      e.preventDefault(); err("#lg-err", "");
      const email = $("#lg-email").value.trim(), pass = $("#lg-pass").value;
      if (!/.+@.+\..+/.test(email) || !pass) { err("#lg-err", "Entrez votre courriel et votre mot de passe."); return; }
      const b = $("#lg-go"); b.disabled = true;
      try { await LensCloud.signIn(email, pass); try { sessionStorage.setItem("portail", "1"); } catch (_) {} location.hash = "tableau"; location.reload(); }
      catch (ex) { err("#lg-err", /Invalid login/i.test(ex.message) ? "Courriel ou mot de passe incorrect." : /not confirmed/i.test(ex.message) ? "Adresse non confirmée : cliquez le lien reçu par courriel, puis réessayez." : ex.message); b.disabled = false; }
    });
    // création de l'espace
    $('#connexion [data-cv="creer"]').addEventListener("submit", async (e) => {
      e.preventDefault(); err("#co-err", "");
      const nom = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
      if (!nom || !/.+@.+\..+/.test(email)) { err("#co-err", "Indiquez le nom de l’entreprise et un courriel valide."); return; }
      const setCompany = () => { D.company.name = nom; D.company.sector = f.sector.value; D.company.size = f.size.value; D.company.email = email; const local = email.split("@")[0].split(/[._-]/)[0]; if (local && local !== "direction" && local !== "info") D.company.first = local[0].toUpperCase() + local.slice(1); };
      if (!CLOUD) { setCompany(); save(); applyCompany(); toast("Espace « " + nom + " » créé"); location.hash = "departements"; return; }
      if (f.pass.value.length < 8) { err("#co-err", "Le mot de passe doit faire au moins 8 caractères."); return; }
      if (f.pass.value !== f.pass2.value) { err("#co-err", "Les deux mots de passe ne correspondent pas."); return; }
      const b = $("#btn-create"); b.disabled = true;
      try {
        const entrepriseId = await LensCloud.createCompany(email, nom);          // refuse les adresses non invitées
        const { session } = await LensCloud.signUp(email, f.pass.value, nom);
        if (!session) { err("#co-err", "Compte créé. Confirmez votre adresse via le courriel reçu, puis connectez-vous."); b.disabled = false; return; }
        D = JSON.parse(JSON.stringify(DEF)); D.departments = []; D.users = []; D.projects = []; D.processes = []; D.steps = []; D.extraInvited = 0; setCompany();
        await LensCloud.saveSpace(entrepriseId, D);
        try { sessionStorage.setItem("portail", "1"); } catch (_) {}
        location.hash = "departements"; location.reload();
      } catch (ex) { err("#co-err", /already registered/i.test(ex.message) ? "Un compte existe déjà avec ce courriel : connectez-vous." : ex.message); b.disabled = false; }
    });
  }
  function applyCompany() {
    $$(".co-sub").forEach((el) => { el.textContent = (D.company.name || (CLOUD && ME && ME.entreprises && ME.entreprises.nom) || "Votre entreprise") + " · configuration de l’espace"; });
    const h = $("#home-name"); if (h) h.textContent = D.company.first || (CLOUD && ME && ME.nom ? ME.nom.split(" ")[0] : "") || "";
  }

  // ───────────────────────── écran 2 : départements ─────────────────────────
  const IN = (focus, bold) => "height: 42px; box-sizing: border-box; border-radius: 12px; border: 1.5px solid " + (focus ? "#111113" : "#dcdce0") + "; padding: 0 12px; font: inherit; font-size: 14px;" + (bold ? " font-weight: 600;" : "") + " color: #111113; min-width: 0";
  function renderDepts() {
    const box = $("#dep-rows"); if (!box) return;
    const names = deptNames();
    box.innerHTML = D.departments.map((d, i) => {
      const opts = ['<option' + (d.parent === "" ? " selected" : "") + '>— (sommet)</option>'].concat(names.filter((n) => n !== d.name).map((n) => '<option' + (n === d.parent ? " selected" : "") + ">" + esc(n) + "</option>")).join("");
      return '<div data-i="' + i + '" style="display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.1fr) minmax(0, 1.1fr) 90px 36px; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid #ececef">' +
        '<input data-k="name" aria-label="Département" value="' + esc(d.name) + '" style="' + IN(false, true) + '">' +
        '<input data-k="resp" aria-label="Responsable" value="' + esc(d.resp) + '" style="' + IN(false, false) + '">' +
        '<select data-k="parent" aria-label="Relève de" style="height: 42px; box-sizing: border-box; border-radius: 12px; border: 1.5px solid #dcdce0; padding: 0 8px; font: inherit; font-size: 14px; color: ' + (d.parent === "" ? "#5e5e65" : "#111113") + '; background: #ffffff; min-width: 0">' + opts + "</select>" +
        '<input data-k="n" aria-label="Employés" value="' + esc(d.n) + '" style="' + IN(false, false) + '">' +
        '<button type="button" data-del="' + i + '" aria-label="Supprimer" style="width: 36px; height: 36px; border-radius: 50%; border: none; background: #f1f1f3; font: inherit; cursor: pointer">×</button></div>';
    }).join("");
    renderTree(); renderInvites();
  }
  function renderTree() {
    const tree = $("#dep-tree"); if (!tree) return;
    const badge = $("#dep-badge"); if (badge) badge.textContent = D.departments.length + " départements · " + totalEmployees() + " employés";
    const kids = (p) => D.departments.filter((d) => (d.parent || "") === p);
    const row = (d, lvl) => {
      const meta = esc(d.resp) + " · " + esc(d.n);
      if (lvl === 0) return '<div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px; background: radial-gradient(130% 260% at 90% -60%, #4a4a4f 0%, #1a1a1d 40%, #070708 100%); color: #ffffff"><b>' + esc(d.name) + '</b><span style="font-size: 12px; color: #d4d4d8">' + meta + "</span></div>";
      if (lvl === 1) return '<div style="display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-radius: 14px; border: 1.5px solid #111113"><b>' + esc(d.name) + '</b><span style="font-size: 12px; color: #5e5e65">' + meta + "</span></div>";
      return '<div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: 14px; background: #f4f4f6"><span style="font-weight: 600">' + esc(d.name) + '</span><span style="font-size: 12px; color: #5e5e65">' + meta + "</span></div>";
    };
    const walk = (p, lvl, seen) => kids(p).filter((d) => !seen.has(d.name)).map((d) => { seen.add(d.name); const c = walk(d.name, lvl + 1, seen); return row(d, lvl) + (c ? '<div style="margin-left: 18px; padding-left: 16px; border-left: 1.5px solid ' + (lvl === 0 ? "#111113" : "#a9a9b0") + '; display: flex; flex-direction: column; gap: 8px">' + c + "</div>" : ""); }).join("");
    tree.innerHTML = walk("", 0, new Set()) || '<p style="margin:0;font-size:13px;color:#5e5e65">Ajoutez un département pour voir la structure.</p>';
  }
  function treeHTML() { const t = $("#dep-tree"); if (!t) return ""; renderTree(); return D.departments.length ? t.innerHTML : ""; }
  function initDepts() {
    const box = $("#dep-rows"); if (!box) return;
    box.addEventListener("input", (e) => { const r = e.target.closest("[data-i]"); if (!r) return; const d = D.departments[+r.dataset.i]; const k = e.target.dataset.k; if (!d || !k) return;
      if (k === "parent") d.parent = e.target.value === "— (sommet)" ? "" : e.target.value; else if (k === "n") d.n = Math.max(0, parseInt(e.target.value, 10) || 0); else d[k] = e.target.value;
      save(); renderTree(); renderInvites(); });
    box.addEventListener("change", (e) => { if (e.target.dataset.k === "name") renderDepts(); });
    box.addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (!b) return; const d = D.departments[+b.dataset.del];
      dialog({ title: "Supprimer « " + d.name + " » ?", text: "Les départements qui en relèvent remonteront d’un niveau.", ok: "Supprimer" }).then((ok) => { if (!ok) return;
        D.departments.forEach((x) => { if (x.parent === d.name) x.parent = d.parent; }); D.departments.splice(+b.dataset.del, 1); save(); renderDepts(); toast("Département supprimé"); }); });
    $("#dep-add").addEventListener("click", () => dialog({ title: "Nouveau département", fields: [{ name: "name", label: "Département" }, { name: "resp", label: "Responsable" }, { name: "parent", label: "Relève de", options: ["— (sommet)"].concat(deptNames()), value: "Direction" }, { name: "n", label: "Employés", type: "number", value: "3" }], ok: "Ajouter" })
      .then((v) => { if (!v || !v.name) return; D.departments.push({ name: v.name, resp: v.resp, parent: v.parent === "— (sommet)" ? "" : v.parent, n: parseInt(v.n, 10) || 0 }); save(); renderDepts(); toast("« " + v.name + " » ajouté"); }));
    $("#dep-template").addEventListener("click", () => dialog({ title: "Appliquer le gabarit Construction ?", text: "Les 8 départements types remplaceront la liste actuelle.", ok: "Appliquer" }).then((ok) => { if (!ok) return; D.departments = JSON.parse(JSON.stringify(GABARIT)); save(); renderDepts(); toast("Gabarit Construction appliqué"); }));
    $("#dep-import").addEventListener("click", () => pickFile(".csv,.txt").then((txt) => { if (!txt) return; const rows = parseCSV(txt).filter((r) => r.length >= 2 && !/^d[ée]partement$/i.test(r[0]));
      if (!rows.length) { toast("Aucune ligne lisible : attendu « Département;Responsable;Relève de;Employés »", false); return; }
      D.departments = rows.map((r) => ({ name: r[0], resp: r[1] || "", parent: r[2] && !/sommet/i.test(r[2]) ? r[2] : "", n: parseInt(r[3], 10) || 0 })); save(); renderDepts(); toast(rows.length + " départements importés"); }));
  }

  // ───────────────────────── écran 3 : utilisateurs ─────────────────────────
  const ST = { active: '<span style="font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; background: #111113; color: #ffffff; white-space: nowrap">Active</span>', sent: '<span style="font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 999px; border: 1.5px solid #111113; white-space: nowrap">Invitation envoyée</span>', todo: '<span style="font-size: 12px; font-weight: 600; padding: 4px 9px; border-radius: 999px; border: 1.5px dashed #6b6b72; color: #5e5e65; white-space: nowrap">À inviter</span>' };
  function renderUsers() {
    const body = $("#usr-body"); if (!body) return;
    body.innerHTML = D.users.map((u, i) => '<tr data-i="' + i + '" style="border-top: 1px solid #ececef"><td style="padding: 11px 8px 11px 0"><span style="display: flex; align-items: center; gap: 10px"><span style="flex: none; width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(160deg, #e9e9ec, #c4c4ca); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px">' + esc(initials(u.name)) + '</span><span style="display: flex; flex-direction: column"><b style="font-weight: 600">' + esc(u.name) + '</b><span style="font-size: 12px; color: #5e5e65">' + esc(u.mail) + '</span></span></span></td><td style="padding: 11px 8px">' + esc(u.dept) + '</td><td style="padding: 11px 8px">' + esc(u.role) + '</td><td style="padding: 11px 0 11px 8px; text-align: right"><button type="button" data-cycle="' + i + '" title="Changer le statut" style="border: none; background: transparent; padding: 0; font: inherit; cursor: pointer">' + ST[u.status] + "</button></td></tr>").join("");
    renderInvites();
    const sel = $("#inv-dept"); if (sel) sel.innerHTML = deptNames().map((n) => "<option>" + esc(n) + "</option>").join("");
  }
  function renderInvites() {
    const count = $("#inv-count"); if (!count) return;
    const total = totalEmployees(); const listed = D.users.filter((u) => u.status !== "todo");
    const invited = Math.min(total, listed.length + (D.extraInvited || 0));
    const active = Math.min(invited, D.users.filter((u) => u.status === "active").length + Math.round((D.extraInvited || 0) * 0.6));
    count.textContent = invited; $("#inv-total").textContent = total; $("#inv-bar").style.width = (total ? Math.round(invited / total * 100) : 0) + "%";
    $("#inv-active").textContent = active + " comptes actifs"; $("#inv-pending").textContent = (invited - active) + " en attente";
    const box = $("#inv-depts"); const main = D.departments.slice(0, 4); const others = D.departments.slice(4);
    const line = (name, a, b) => '<div style="display: flex; flex-direction: column; gap: 5px"><span style="display: flex; justify-content: space-between"><span>' + esc(name) + "</span><b>" + a + " / " + b + '</b></span><span style="display: block; height: 6px; border-radius: 6px; background: #e4e4e8"><span style="display: block; width: ' + (b ? Math.min(100, Math.round(a / b * 100)) : 0) + '%; height: 6px; border-radius: 6px; background: #111113"></span></span></div>';
    const inv = (d) => Math.min(d.n, D.users.filter((u) => u.dept === d.name && u.status !== "todo").length + Math.round(d.n * 0.55));
    box.innerHTML = main.map((d) => line(d.name, inv(d), d.n)).join("") + (others.length ? line("Autres départements", others.reduce((a, d) => a + Math.round(inv(d) * 0.3), 0), others.reduce((a, d) => a + d.n, 0)) : "");
  }
  function initUsers() {
    const btn = $("#inv-btn"); if (!btn) return;
    btn.addEventListener("click", () => { const mail = $("#inv-mail").value.trim(); if (!/.+@.+\..+/.test(mail)) { toast("Entrez un courriel valide.", false); return; }
      if (D.users.some((u) => u.mail.toLowerCase() === mail.toLowerCase())) { toast("Cette personne est déjà dans la liste.", false); return; }
      const local = mail.split("@")[0]; const parts = local.split(/[._-]/); const name = parts.length > 1 ? parts[0][0].toUpperCase() + ". " + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join(" ") : local;
      D.users.unshift({ name, mail, dept: $("#inv-dept").value, role: $("#inv-role").value, status: "sent" }); save(); renderUsers(); $("#inv-mail").value = ""; toast("Invitation envoyée à " + mail); });
    $("#usr-body").addEventListener("click", (e) => { const b = e.target.closest("[data-cycle]"); if (!b) return; const u = D.users[+b.dataset.cycle]; u.status = { todo: "sent", sent: "active", active: "todo" }[u.status]; save(); renderUsers(); });
    $("#inv-sync").addEventListener("click", () => { btn.disabled = true; toast("Synchronisation avec Microsoft Entra ID…");
      setTimeout(() => { const add = [["Catherine Dubois", "Opérations", "Contributrice"], ["Hugo Lemieux", "Ventes", "Contributeur"], ["Sophie Martel", "Ressources humaines", "Gestionnaire"]].filter(([n]) => !D.users.some((u) => u.name === n));
        add.forEach(([n, d, r]) => D.users.push({ name: n, mail: n.toLowerCase().replace(/\s+/, ".").normalize("NFD").replace(/[̀-ͯ]/g, "") + "@" + (D.company.email.split("@")[1] || "exemple.ca"), dept: d, role: r, status: "sent" }));
        btn.disabled = false; save(); renderUsers(); toast(add.length ? add.length + " comptes synchronisés depuis Entra ID" : "Annuaire déjà à jour"); }, 1200); });
    $("#inv-import").addEventListener("click", () => pickFile(".csv,.txt").then((txt) => { if (!txt) return; const rows = parseCSV(txt).filter((r) => /@/.test(r[0] || "") || /@/.test(r[1] || "")); let n = 0;
      rows.forEach((r) => { const mail = r.find((c) => /@/.test(c)); const name = r.find((c) => c && !/@/.test(c) && !deptNames().includes(c)) || mail.split("@")[0]; if (D.users.some((u) => u.mail === mail)) return; D.users.push({ name, mail, dept: r.find((c) => deptNames().includes(c)) || deptNames()[0], role: "Contributeur", status: "sent" }); n++; });
      save(); renderUsers(); toast(n ? n + " invitations créées depuis le fichier" : "Aucun courriel trouvé dans le fichier", !!n); }));
  }

  // ───────────────────────── écran 4 : objectifs ─────────────────────────
  function chipGroup(boxSel, isOn, onPick) {
    const box = $(boxSel); if (!box) return;
    const paint = () => $$("button", box).forEach((b) => { const on = isOn(b.textContent.replace(/^✓\s*/, "").trim()); b.style.background = on ? "#111113" : (b.style.borderColor ? "#ffffff" : "#f1f1f3"); b.style.color = on ? "#ffffff" : "#111113"; if (b.style.borderWidth || /border: 1.5px/.test(b.getAttribute("style") || "")) { b.style.borderColor = on ? "#111113" : "#dcdce0"; } b.textContent = (b.dataset.check === "1" ? (on ? "✓ " : "") : "") + b.textContent.replace(/^✓\s*/, "").trim(); });
    box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; onPick(b.textContent.replace(/^✓\s*/, "").trim()); paint(); });
    paint();
  }
  const GRADC = "radial-gradient(130% 160% at 90% -10%, #4a4a4f 0%, #1a1a1d 40%, #070708 100%)";
  const objDeptCount = (o) => (Array.isArray(o.depts) ? o.depts.length : Number(o.depts) || 0);
  function renderObjectives() {
    const list = $("#obj-list"); if (!list) return;
    const n = D.objectives.length;
    $("#obj-badge").textContent = n + (n > 1 ? " objectifs" : " objectif");
    if (!n) { list.innerHTML = '<div style="border-radius: 22px; padding: 24px 20px; background: #f4f4f6; display: flex; flex-direction: column; gap: 6px; text-align: center"><b style="font-size: 15px">Aucun objectif enregistré</b><span style="font-size: 13.5px; line-height: 1.5; color: #5e5e65">Les objectifs que vous enregistrez apparaissent ici, avec leur poids relatif.</span></div>'; return; }
    list.innerHTML = D.objectives.map((o, i) => {
      const nd = objDeptCount(o), ni = (o.indicators || []).length;
      const meta = [nd + (nd > 1 ? " départements" : " département"), ni ? ni + (ni > 1 ? " indicateurs" : " indicateur") : null, o.horizon || null].filter(Boolean).join(" · ");
      return '<div style="border-radius: 22px; padding: 20px; background: ' + GRADC + '; color: #ffffff; display: flex; flex-direction: column; gap: 12px"><div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px"><span style="font-size: 12.5px; font-weight: 600; letter-spacing: 0.06em">' + esc(o.cat.toUpperCase()) + " · POIDS " + o.weight + ' %</span><button type="button" data-objdel="' + i + '" aria-label="Retirer" style="border: none; background: transparent; color: inherit; font: inherit; font-size: 16px; cursor: pointer; line-height: 1">×</button></div><span style="font-size: 16px; font-weight: 600">' + esc(o.title) + '</span><div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; font-size: 13px; color: #d4d4d8"><span>•••• ' + esc(meta) + '</span><b style="color: #ffffff; font-size: 18px; white-space: nowrap">' + esc(o.target || "—") + "</b></div></div>";
    }).join("");
  }
  function objTarget() { const op = $("#obj-op").value, a = $("#obj-min").value.trim(), b = $("#obj-max").value.trim(), u = $("#obj-unit").value.trim(), per = $("#obj-per").value.trim();
    if (!a && !b) return ""; const core = op === "↔" ? (a && b ? a + " à " + b : a || b) : op + " " + (a || b); return (core + " " + u).trim() + (per ? " / " + per : ""); }
  function objWeights() { const n = D.objectives.length; if (!n) return; const w = Math.floor(100 / n); D.objectives.forEach((o, i) => { o.weight = w + (i < 100 - w * n ? 1 : 0); }); }
  const DEPT_ON = "display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1.5px solid #111113; background: #111113; color: #ffffff; font: inherit; font-size: 13.5px; cursor: pointer";
  const DEPT_OFF = "min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1.5px solid #dcdce0; background: #ffffff; color: #111113; font: inherit; font-size: 13.5px; cursor: pointer";
  function renderObjDepts() {
    const box = $("#obj-depts"); if (!box) return;
    D.objForm.depts = D.objForm.depts.filter((d) => deptNames().includes(d));
    box.innerHTML = D.departments.length ? D.departments.map((d) => { const on = D.objForm.depts.includes(d.name); return '<button type="button" data-dept="' + esc(d.name) + '" style="' + (on ? DEPT_ON : DEPT_OFF) + '">' + (on ? "✓ " : "") + esc(d.name) + "</button>"; }).join("")
      : '<span style="font-size: 13.5px; color: #5e5e65">Aucun département : créez-les à l’étape 1.</span>';
  }
  function renderIndRows() {
    const box = $("#ind-rows"); if (!box) return;
    const ds = D.objForm.depts;
    if (!ds.length) { box.innerHTML = '<div style="padding: 16px; font-size: 13.5px; color: #5e5e65; text-align: center">Sélectionnez des départements pour définir l’indicateur de chacun.</div>'; return; }
    const F = "height: 42px; box-sizing: border-box; border-radius: 10px; border: 1.5px solid #dcdce0; padding: 0 12px; font: inherit; font-size: 14px; font-weight: 400; color: #111113; background: #ffffff; min-width: 0; width: 100%";
    box.innerHTML = '<div style="display: grid; grid-template-columns: 150px minmax(0, 1fr) 170px; gap: 12px; align-items: center; padding: 10px 16px; background: #fafafb; font-size: 12.5px; color: #5e5e65"><span>Département</span><span>Indicateur</span><span>Cible</span></div>' +
      ds.map((d, i) => { const v = D.objForm.inds[d] || {}; return '<div style="display: grid; grid-template-columns: 150px minmax(0, 1fr) 170px; gap: 12px; align-items: center; padding: 10px 16px; border-top: 1px solid #ececef; font-size: 14px"><span style="font-size: 12px; font-weight: 700; letter-spacing: 0.1em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title="' + esc(d) + '">' + esc(d.toUpperCase()) + '</span><input data-ind-name="' + esc(d) + '" value="' + esc(v.name || "") + '" placeholder="Ex. : Délai de soumission" style="' + F + '"><input data-ind-target="' + esc(d) + '" value="' + esc(v.target || "") + '" placeholder="Ex. : 6 j / dossier" style="' + F + '"></div>'; }).join("");
  }
  function objFormOpen(open) { const f = $("#obj-form"), e = $("#obj-empty"), btn = $("#obj-open"); if (!f) return; f.style.display = open ? "flex" : "none"; e.style.display = open ? "none" : "flex"; btn.style.visibility = open ? "hidden" : "visible";
    if (!open && D.objectives.length) { e.querySelector("b").textContent = D.objectives.length + (D.objectives.length > 1 ? " objectifs enregistrés" : " objectif enregistré"); e.querySelector("span").textContent = "Ajoutez-en un autre ou terminez la configuration pour ouvrir le tableau de bord."; }
    if (open) { renderObjDepts(); renderIndRows(); $("#obj-title").focus(); } }
  function objFormReset() { D.objForm = { cat: "Financier", depts: [], inds: {} }; save(); ["#obj-title", "#obj-min", "#obj-max", "#obj-unit", "#obj-per"].forEach((s) => { $(s).value = ""; }); $("#obj-op").value = "↔"; $("#obj-max").style.display = ""; $("#obj-sep").style.display = ""; $("#obj-horizon").selectedIndex = 0; renderObjDepts(); renderIndRows();
    $$("#obj-cats button").forEach((b, i) => { b.style.background = i === 0 ? "#111113" : "#f1f1f3"; b.style.color = i === 0 ? "#ffffff" : "#111113"; }); }
  function initObjectives() {
    if (!$("#obj-open")) return;
    chipGroup("#obj-cats", (t) => t === D.objForm.cat, (t) => { D.objForm.cat = t; save(); });
    $("#obj-depts").addEventListener("click", (e) => { const b = e.target.closest("button[data-dept]"); if (!b) return; const d = b.dataset.dept; const i = D.objForm.depts.indexOf(d); if (i < 0) D.objForm.depts.push(d); else D.objForm.depts.splice(i, 1); save(); renderObjDepts(); renderIndRows(); });
    $("#ind-rows").addEventListener("input", (e) => { const t = e.target; const d = t.dataset.indName || t.dataset.indTarget; if (!d) return; const v = D.objForm.inds[d] || (D.objForm.inds[d] = {}); if (t.dataset.indName != null) v.name = t.value; else v.target = t.value; save(); });
    $("#obj-op").addEventListener("change", () => { const range = $("#obj-op").value === "↔"; $("#obj-max").style.display = range ? "" : "none"; $("#obj-sep").style.display = range ? "" : "none"; });
    $("#obj-open").addEventListener("click", () => objFormOpen(true));
    $("#obj-cancel").addEventListener("click", () => { objFormReset(); objFormOpen(false); });
    $("#obj-save").addEventListener("click", () => {
      const title = $("#obj-title").value.trim(); if (!title) { toast("Donnez un nom à l’objectif.", false); $("#obj-title").focus(); return; }
      if (!D.objForm.depts.length) { toast("Sélectionnez au moins un département lié à cet objectif.", false); return; }
      const id = Date.now();
      const indicators = D.objForm.depts.map((d) => { const v = D.objForm.inds[d] || {}; return v.name && v.name.trim() ? { dept: d, name: v.name.trim(), target: (v.target || "").trim(), obj: id } : null; }).filter(Boolean);
      D.objectives.push({ id, cat: D.objForm.cat, title, depts: D.objForm.depts.slice(), target: objTarget(), horizon: $("#obj-horizon").value, status: "active", indicators, weight: 0 });
      objWeights(); indicators.forEach((x) => D.indicators.push(x)); save(); renderObjectives(); objFormReset(); objFormOpen(false); toast("Objectif « " + title + " » enregistré"); });
    $("#obj-list").addEventListener("click", (e) => { const b = e.target.closest("[data-objdel]"); if (!b) return; const o = D.objectives.splice(+b.dataset.objdel, 1)[0]; if (o && o.id) D.indicators = D.indicators.filter((x) => x.obj !== o.id); objWeights(); save(); renderObjectives(); objFormOpen($("#obj-form").style.display !== "none"); toast("Objectif retiré"); });
    renderObjectives(); objFormOpen(false);
  }

  // ───────────────────────── écran 5 : nouveau diagnostic ─────────────────────────
  function initTask() {
    const name = $("#task-name"); if (!name) return;
    name.value = D.task.name; $("#task-dept").innerHTML = deptNames().map((n) => "<option" + (n === D.task.dept ? " selected" : "") + ">" + esc(n) + "</option>").join("");
    $("#task-proc").innerHTML = ["Nouveau processus"].concat(D.processes.map((p) => p.title)).map((t) => "<option" + (t === D.task.proc ? " selected" : "") + ">" + esc(t) + "</option>").join("");
    chipGroup("#task-freq", (t) => t === D.task.freq, (t) => { D.task.freq = t; save(); });
    $$("#task-win span").forEach((s) => { s.style.cursor = "pointer"; });
    $("#task-win").addEventListener("click", (e) => { const s = e.target.closest("span"); if (!s || /exclue/.test(s.textContent)) return; const t = s.textContent.replace(/^✓\s*/, "").trim(); const i = D.task.windows.indexOf(t);
      if (i < 0) { D.task.windows.push(t); s.style.background = "#111113"; s.style.color = "#fff"; s.textContent = "✓ " + t; } else { D.task.windows.splice(i, 1); s.style.background = "#f1f1f3"; s.style.color = "#111113"; s.textContent = t; } save(); });
    $("#rec-start").addEventListener("click", (e) => {
      if (!$("#task-consent").checked) { e.preventDefault(); toast("Cochez le consentement à l’enregistrement pour démarrer.", false); return; }
      if (!name.value.trim()) { e.preventDefault(); toast("Donnez un nom à la tâche.", false); return; }
      if (!D.task.windows.length) { e.preventDefault(); toast("Choisissez au moins une fenêtre à capter.", false); return; }
      D.task.name = name.value.trim(); D.task.dept = $("#task-dept").value; D.task.proc = $("#task-proc").value;
      D.rec = { elapsed: 0, paused: false, running: true, clicks: 0, captures: 0, actions: [{ t: 0, label: "Démarrage de l’enregistrement", tag: "Lens", kind: "f" }], total: null, pool: 0 };
      save(); applyTask(); toast("Enregistrement démarré"); });
  }
  function applyTask() { $$(".task-title").forEach((el) => (el.textContent = D.task.name || "Aucun diagnostic")); $$(".task-sub").forEach((el) => (el.textContent = "Diagnostic · " + D.task.dept + (el.closest("#enregistrement") ? " · " + (D.users.find((u) => u.dept === D.task.dept) || { name: D.company.first }).name : ""))); }

  // ───────────────────────── écran 6 : enregistrement ─────────────────────────
  const POOL = [["Ouverture de Plans_Laval.pdf", "Document entrant", "f"], ["Mesures prises dans la maquette", "Revit · 46 clics", "f"], ["Création de Estimation_Projet-Laval.xlsx", "Excel · document sortant", "f"], ["Quantités ressaisies depuis Revit", "Saisie double détectée", "dark"], ["Courriel envoyé au fournisseur", "Outlook · demande de prix", "f"], ["Copie des prix dans Excel", "Saisie double détectée", "dark"], ["Mise en page de la soumission", "Word", "f"], ["Soumission.pdf exportée", "Document sortant", "f"]];
  let recTimer = null;
  function actionRow(a) {
    const t = mmss(a.t); if (a.kind === "dark") return '<li style="display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid #ececef"><span style="font-size: 12.5px; color: #5e5e65">' + t + '</span><span style="display: flex; flex-direction: column; gap: 3px"><span style="font-size: 13.5px">' + esc(a.label) + '</span><span style="align-self: flex-start; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #111113; color: #ffffff">' + esc(a.tag) + "</span></span></li>";
    if (a.kind === "live") return '<li style="display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid #ececef"><span style="font-size: 12.5px; font-weight: 700">' + t + '</span><span style="display: flex; flex-direction: column; gap: 3px"><span style="font-size: 13.5px; font-weight: 600">' + esc(a.label) + '</span><span style="align-self: flex-start; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; border: 1.5px solid #111113">' + esc(a.tag) + "</span></span></li>";
    return '<li style="display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-top: 1px solid #ececef"><span style="font-size: 12.5px; color: #5e5e65">' + t + '</span><span style="display: flex; flex-direction: column; gap: 3px"><span style="font-size: 13.5px">' + esc(a.label) + '</span><span style="align-self: flex-start; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #f1f1f3">' + esc(a.tag) + "</span></span></li>";
  }
  function renderRec() {
    const timer = $("#rec-timer"); if (!timer) return;
    if (!D.rec) { timer.textContent = "Enregistrement · 00:00"; $("#rec-actions").innerHTML = '<li style="padding: 10px 0; font-size: 13.5px; color: #5e5e65">Aucun enregistrement en cours. Lancez-en un depuis « Créer un diagnostic ».</li>'; return; }
    timer.textContent = (!D.rec.running ? "Terminé · " : D.rec.paused ? "En pause · " : "Enregistrement · ") + mmss(D.rec.elapsed);
    $("#rec-dot").style.background = D.rec.paused ? "#9a9aa1" : "#111113"; $("#rec-pause").textContent = D.rec.paused ? "Reprendre" : "Pause";
    $("#rec-counter").textContent = D.rec.clicks + " clics · " + D.rec.captures + " captures";
    const live = D.rec.running ? [{ t: D.rec.elapsed, label: "Saisie des quantités en cours…", tag: ($("#task-win") ? (D.task.windows[0] || "Écran") : "Excel") + " · en direct", kind: "live" }] : [];
    $("#rec-actions").innerHTML = D.rec.actions.concat(live).map(actionRow).join("");
  }
  function tick() { if (!D.rec || !D.rec.running || D.rec.paused || location.hash !== "#enregistrement") return; D.rec.elapsed++; D.rec.clicks += Math.random() < 0.7 ? 1 : 0;
    if (D.rec.elapsed % 7 === 0) { const p = POOL[D.rec.pool % POOL.length]; D.rec.pool++; D.rec.captures++; D.rec.clicks += 3 + Math.floor(Math.random() * 6); D.rec.actions.push({ t: D.rec.elapsed, label: p[0], tag: p[1], kind: p[2] }); }
    if (D.rec.elapsed % 5 === 0) save(); renderRec(); }
  function initRec() {
    if (!$("#rec-timer")) return; recTimer = setInterval(tick, 1000);
    $("#rec-pause").addEventListener("click", () => { if (!D.rec) return; D.rec.paused = !D.rec.paused; D.rec.actions.push({ t: D.rec.elapsed, label: D.rec.paused ? "Pause" : "Reprise", tag: "Lens", kind: "f" }); save(); renderRec(); });
    $("#rec-note").addEventListener("click", () => { if (!D.rec) { toast("Aucun enregistrement en cours.", false); return; } dialog({ title: "Note vocale", text: "La transcription est simulée : tapez le contenu de la note.", fields: [{ name: "txt", label: "Note", type: "textarea" }], ok: "Ajouter" }).then((v) => { if (!v || !v.txt) return; D.rec.actions.push({ t: D.rec.elapsed, label: "Note : " + v.txt, tag: "Note vocale", kind: "f" }); save(); renderRec(); toast("Note ajoutée à la chronologie"); }); });
    $("#rec-finish").addEventListener("click", () => { if (!D.rec) return; D.rec.running = false; D.rec.total = D.rec.elapsed; D.rec.actions.push({ t: D.rec.elapsed, label: "Fin de l’enregistrement", tag: "Lens", kind: "f" });
      const p = D.processes.find((x) => x.title === D.task.name); if (p) p.recs++; else D.processes.unshift({ dept: D.task.dept.toUpperCase(), ver: "v1", title: D.task.name, steps: D.steps.length, recs: 1 }); D.activeProc = Math.max(0, D.processes.findIndex((x) => x.title === D.task.name)); D.procValidated = false;
      save(); renderProcesses(); applyTask(); toast("Enregistrement terminé · processus proposé à partir de " + D.rec.clicks + " clics"); });
  }

  // ───────────────────────── écran 5 : enregistrement réel de l'écran (curseur inclus) ─────────────────────────
  const SCR = { stream: null, rec: null, chunks: [], elapsed: 0, paused: false, timer: null, mime: "", frames: [], frameTimer: null };
  const FRAME_EVERY_S = 2, FRAME_MAX = 150, FRAME_WIDTH = 1024;
  /** Luminosité moyenne (0-255) d'un canevas, sur un échantillon de pixels : sert à écarter les images noires. */
  function canvasBrightness(c) { try { const w = 32, h = 18; const t = document.createElement("canvas"); t.width = w; t.height = h; t.getContext("2d").drawImage(c, 0, 0, w, h); const d = t.getContext("2d").getImageData(0, 0, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); } catch (_) { return 255; } }
  /** Extrait une image toutes les `pas` secondes de la vidéo enregistrée (au plus FRAME_MAX), en écartant les images noires. */
  async function framesFromBlob(blob, onProgress) {
    const out = []; const url = URL.createObjectURL(blob); const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    const once = (ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("délai " + ev)), ms || 8000); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); v.addEventListener("error", () => { clearTimeout(t); rej(new Error("vidéo illisible")); }, { once: true }); });
    try {
      await once("loadedmetadata", 10000);
      if (!isFinite(v.duration) || v.duration <= 0) { v.currentTime = 1e101; await once("timeupdate", 10000); }   // WebM du navigateur : la durée n'est connue qu'après ce saut
      const duree = isFinite(v.duration) && v.duration > 0 ? v.duration : SCR.elapsed || 0; if (!duree) return out;
      const pas = Math.max(FRAME_EVERY_S, duree / FRAME_MAX); const c = document.createElement("canvas");
      for (let t = 0.3; t < duree; t += pas) {
        v.currentTime = Math.min(t, Math.max(0, duree - 0.05)); try { await once("seeked", 6000); } catch (_) { break; }
        if (!v.videoWidth) continue; const w = Math.min(FRAME_WIDTH, v.videoWidth); c.width = w; c.height = Math.round(v.videoHeight * w / v.videoWidth);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        if (canvasBrightness(c) < 6) continue;   // image noire (écran non partagé, écran verrouillé…)
        const b = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.72)); if (b) out.push(b);
        if (onProgress) onProgress(Math.min(1, t / duree));
      }
    } catch (e) { console.warn("Extraction des images :", e); }
    finally { URL.revokeObjectURL(url); v.removeAttribute("src"); try { v.load(); } catch (_) {} }
    return out;
  }
  function scrCaptureFrame() {
    const v = $("#scr-preview"); if (!v || !v.videoWidth || SCR.paused || !SCR.rec) return;
    if (SCR.frames.length >= FRAME_MAX) { SCR.frames = SCR.frames.filter((_, i) => i % 2 === 0); clearInterval(SCR.frameTimer); SCR.frameTimer = setInterval(scrCaptureFrame, FRAME_EVERY_S * 2000); }
    const c = document.createElement("canvas"); const w = Math.min(FRAME_WIDTH, v.videoWidth); c.width = w; c.height = Math.round(v.videoHeight * w / v.videoWidth);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    if (canvasBrightness(c) < 6) return;   // onglet en arrière-plan : l'aperçu ne se rafraîchit pas et donne du noir
    c.toBlob((b) => { if (b) SCR.frames.push(b); }, "image/jpeg", 0.72);
  }
  function scrUI() {
    const on = !!SCR.rec; const show = (id, d) => { const el = $(id); if (el) el.style.display = d; };
    show("#scr-start", on ? "none" : "flex"); show("#scr-live", on ? "flex" : "none"); show("#scr-pause", on ? "inline-block" : "none"); show("#scr-finish", on ? "inline-block" : "none");
    show("#scr-preview", on ? "block" : "none"); show("#scr-hint", on ? "none" : "block"); if (on) show("#scr-card", "flex"); else if (activeEpc()) show("#scr-card", "none");
    const t = $("#scr-timer"); if (t) t.textContent = (SCR.paused ? "En pause · " : "Enregistrement · ") + mmss(SCR.elapsed);
    const dot = $("#scr-dot"); if (dot) dot.style.background = SCR.paused ? "#9a9aa1" : "#c62828";
    const pb = $("#scr-pause"); if (pb) pb.textContent = SCR.paused ? "Reprendre" : "Pause";
  }
  async function scrStart() {
    if (SCR.rec) return;
    { const p = activeProc(); if (p) { const desc = diagDesc(p); D.task = { name: nextDiagName(p), desc, dept: p.dept[0] + p.dept.slice(1).toLowerCase(), proc: p.title, freq: "", windows: [] }; save(); } }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast("Ce navigateur ne permet pas d’enregistrer l’écran (utilisez Chrome ou Edge, en https).", false); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 }, cursor: "always" }, audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include", monitorTypeSurfaces: "include" }); }
    catch (e) { toast(e && e.name === "NotAllowedError" ? "Enregistrement annulé : aucun écran choisi." : "Impossible de démarrer l’enregistrement : " + (e && e.message || e), false); return; }
    SCR.mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
    let rec; try { rec = new MediaRecorder(stream, SCR.mime ? { mimeType: SCR.mime, videoBitsPerSecond: 1200000 } : undefined); } catch (e) { stream.getTracks().forEach((t) => t.stop()); toast("Enregistreur vidéo indisponible : " + e.message, false); return; }
    SCR.stream = stream; SCR.rec = rec; SCR.chunks = []; SCR.elapsed = 0; SCR.paused = false; SCR.frames = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) SCR.chunks.push(e.data); };
    rec.onstop = scrSave;
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (SCR.rec && SCR.rec.state !== "inactive") SCR.rec.stop(); });   // « Arrêter le partage » du navigateur
    const v = $("#scr-preview"); if (v) { v.srcObject = stream; }
    rec.start(1000);
    SCR.timer = setInterval(() => { if (!SCR.paused) { SCR.elapsed++; scrUI(); } }, 1000);
    SCR.frameTimer = setInterval(scrCaptureFrame, FRAME_EVERY_S * 1000); setTimeout(scrCaptureFrame, 700);
    D.rec = { elapsed: 0, paused: false, running: true, clicks: 0, captures: 0, actions: [{ t: 0, label: "Démarrage de l’enregistrement de l’écran", tag: "Lens", kind: "f" }], total: null, pool: 0 }; save();
    scrUI(); toast("Enregistrement de l’écran démarré");
  }
  function scrPause() { if (!SCR.rec) return; if (SCR.paused) { SCR.rec.resume(); SCR.paused = false; } else { SCR.rec.pause(); SCR.paused = true; } D.rec.actions.push({ t: SCR.elapsed, label: SCR.paused ? "Pause" : "Reprise", tag: "Lens", kind: "f" }); save(); scrUI(); }
  function scrFinish() { if (!SCR.rec) return; if (SCR.rec.state !== "inactive") SCR.rec.stop(); else scrSave(); }
  function scrSave() {
    clearInterval(SCR.timer); SCR.timer = null; clearInterval(SCR.frameTimer); SCR.frameTimer = null;
    const frames = SCR.frames.slice(); SCR.frames = [];
    const blob = new Blob(SCR.chunks, { type: SCR.mime || "video/webm" }); const ext = /mp4/.test(SCR.mime) ? "mp4" : "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const name = "lens-" + (D.task.name || "enregistrement").normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + "-" + stamp + "." + ext;
    const total0 = SCR.elapsed;
    if (blob.size) { if (CLOUD && ME && ME.entreprise_id) scrPublish(blob, name, total0, frames); else download(name, blob, blob.type); }
    if (SCR.stream) SCR.stream.getTracks().forEach((t) => t.stop()); const v = $("#scr-preview"); if (v) v.srcObject = null;
    const total = SCR.elapsed; SCR.rec = null; SCR.stream = null; SCR.chunks = []; SCR.paused = false;
    D.rec = Object.assign(D.rec || { actions: [] }, { elapsed: total, paused: false, running: false, total: total, video: name, taille: blob.size });
    D.rec.actions.push({ t: total, label: "Fin de l’enregistrement · " + name + " (" + fr(blob.size / 1048576, 1) + " Mo)", tag: "Lens", kind: "f" });
    let p = D.processes.find((x) => x.title === (D.task.proc || D.task.name)); if (p) { p.recs++; (p.diagnostics = p.diagnostics || []).push({ name: D.task.name, desc: D.task.desc || "", date: new Date().toISOString(), duree_s: total, video: name }); } else { D.processes.unshift({ dept: (D.task.dept || "").toUpperCase(), ver: "v1", title: D.task.name, steps: 0, recs: 1, epc: null }); p = D.processes[0]; }
    D.activeProc = Math.max(0, D.processes.indexOf(p)); D.procValidated = false; save(); scrUI(); renderProcesses(); renderRec();
    toast(blob.size ? (CLOUD ? "Envoi de la vidéo à Lens… (" + fr(blob.size / 1048576, 1) + " Mo)" : "Vidéo enregistrée : " + name + " (" + mmss(total) + ")") : "Enregistrement arrêté sans vidéo", !!blob.size); renderProcPage();
  }
  let ANALYSE = null;   // { recId, timer } pendant qu'une cartographie est en cours côté serveur
  function scrStatus(msg) { const h = $("#scr-hint"); if (h && !SCR.rec) { h.textContent = msg; const card = $("#scr-card"); if (card) card.style.display = "flex"; } }
  async function scrPublish(blob, name, total, frames) {
    try {
      scrStatus("Envoi de la vidéo (" + fr(blob.size / 1048576, 1) + " Mo)…");
      const r = await LensCloud.uploadRecording(ME.entreprise_id, blob, name, { processus: D.task.proc || D.task.name, departement: D.task.dept, qui: ME.nom || D.company.first, duree_s: total, diagnostic: D.task.name, description: D.task.desc || null });
      if (D.rec) { D.rec.cloudId = r.id; D.rec.fichier = r.path; save(); }
      let n = 0;
      scrStatus("Préparation des images de la vidéo…");
      let images = await framesFromBlob(blob, (pct) => scrStatus("Préparation des images de la vidéo… " + Math.round(pct * 100) + " %"));
      if (!images.length && frames && frames.length) images = frames;   // repli : images captées pendant l'enregistrement
      if (images.length) { n = await LensCloud.uploadFrames(ME.entreprise_id, r.id, images, (i, t) => scrStatus("Envoi des images " + i + " / " + t + "…")); }
      toast("Vidéo envoyée à Lens · " + name + " (" + mmss(total) + ", " + n + " images)");
      if (!n) { scrStatus("Vidéo envoyée, mais aucune image n’a pu être capturée : l’analyse automatique n’est pas possible pour cet enregistrement."); return; }
      scrStatus("Analyse en cours par Lens… Le diagramme apparaîtra ici dans une à deux minutes. Vous pouvez quitter la page.");
      await LensCloud.analyse(r.id);
      scrWatch(r.id);
    } catch (e) {
      console.error(e); toast("Envoi impossible (" + e.message + ") : la vidéo est téléchargée sur cet ordinateur.", false); scrStatus("Envoi impossible : " + e.message); download(name, blob, blob.type);
    }
  }
  function scrWatch(recId) {
    if (ANALYSE && ANALYSE.timer) clearInterval(ANALYSE.timer);
    const debut = Date.now(); ANALYSE = { recId, timer: null };
    ANALYSE.timer = setInterval(async () => {
      try {
        const r = await LensCloud.recording(recId); if (!r) return;
        if (r.statut === "cartographie") { clearInterval(ANALYSE.timer); ANALYSE = null; await reloadSpace(); { const p = activeProc(); if (p) delete DIAG_SEL[p.title]; } toast("Diagramme du processus prêt"); renderProcesses(); renderProcPage(); renderDash(); }
        else if (r.statut === "erreur") { clearInterval(ANALYSE.timer); ANALYSE = null; scrStatus("L’analyse a échoué : " + (r.transcription || "erreur inconnue") + ". Vous pouvez réenregistrer."); toast("Analyse impossible", false); }
        else if (Date.now() - debut > 6 * 60000) { clearInterval(ANALYSE.timer); ANALYSE = null; scrStatus("L’analyse prend plus de temps que prévu. Revenez dans quelques minutes : le diagramme apparaîtra dès qu’il sera prêt."); }
        else scrStatus("Analyse en cours par Lens (" + Math.round((Date.now() - debut) / 1000) + " s)… Le diagramme apparaîtra ici dès qu’il sera prêt.");
      } catch (e) { console.warn(e); }
    }, 5000);
  }
  /** Recharge l'espace depuis la base en ligne (après une écriture côté serveur). */
  async function reloadSpace() {
    if (!CLOUD || !ME || !ME.entreprise_id) return;
    const sp = await LensCloud.loadSpace(ME.entreprise_id);
    if (sp && sp.data && Object.keys(sp.data).length) { D = normalize(Object.assign(JSON.parse(JSON.stringify(DEF)), sp.data)); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (_) {} }
  }
  let DOCS = [];   // documents du processus affiché (noms), pour proposer un intrant ou un sortant
  const docNames = () => DOCS.map((d) => d.nom);
  const docIcon = (nom) => /\.pdf$/i.test(nom) ? "PDF" : /\.xlsx?$|\.csv$/i.test(nom) ? "XLS" : /\.docx?$/i.test(nom) ? "DOC" : /\.pptx?$/i.test(nom) ? "PPT" : /\.md$/i.test(nom) ? "MD" : "TXT";
  async function renderDocs() {
    const box = $("#scr-docs-list"); if (!box) return;
    const vide = (m) => { box.innerHTML = '<div style="border-radius: 16px; padding: 18px 14px; background: #f4f4f6; text-align: center; font-size: 13px; line-height: 1.5; color: #5e5e65">' + m + "</div>"; };
    if (!CLOUD || !ME || !ME.entreprise_id) { vide("L’import de documents demande la base en ligne."); return; }
    let rows = []; try { rows = await LensCloud.listDocuments(ME.entreprise_id, D.task.proc || D.task.name || null); } catch (e) { console.warn(e); vide("Documents indisponibles : " + e.message); return; }
    DOCS = rows;
    if (!rows.length) { vide("Aucun document pour l’instant. Cliquez sur « Importer des documents »."); return; }
    box.innerHTML = '<span style="font-size: 11px; font-weight: 700; letter-spacing: 0.16em; color: #5e5e65">' + rows.length + " / 10</span>" + rows.map((r) => '<div style="display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 14px; background: #f4f4f6"><span style="font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; padding: 6px 0; border-radius: 8px; background: #111113; color: #fff; text-align: center">' + docIcon(r.nom) + '</span><span style="display: flex; flex-direction: column; min-width: 0"><a href="#" data-doc-open="' + esc(r.fichier) + '" style="font-weight: 600; font-size: 14px; color: #111113; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' + esc(r.nom) + '</a><span style="font-size: 12px; color: #5e5e65">' + fr((r.taille || 0) / 1048576, 1) + " Mo · " + new Date(r.cree_le).toLocaleDateString("fr-CA") + (r.diagnostic ? " · " + esc(r.diagnostic) : "") + '</span></span><button type="button" data-doc-del="' + esc(r.id) + '" data-doc-path="' + esc(r.fichier) + '" data-doc-name="' + esc(r.nom) + '" aria-label="Retirer" style="width: 34px; height: 34px; border-radius: 50%; border: none; background: #e4e4e8; font: inherit; cursor: pointer">×</button></div>').join("");
  }
  /** Page d'un processus : en-tête, carte d'enregistrement tant qu'il n'y a rien, diagramme EPC dès qu'il y a de l'information, documents à gauche. */
  function renderProcPage() {
    if (!$("#pp-title")) return; const p = activeProc();
    if (!p || p !== EDIT_P) { setEdit(false); EDIT_P = p; }
    if (!p) { location.hash = "diagnostic"; return; }
    const dept = p.dept ? p.dept[0] + p.dept.slice(1).toLowerCase() : "";
    $("#pp-title").textContent = p.title;
    const nb = (p.diagnostics || []).length; const enCours = D.task.proc === p.title && D.task.name && !(p.diagnostics || []).some((d) => d.name === D.task.name);
    $("#pp-sub").textContent = (enCours ? D.task.name + " à venir · " : nb ? nb + (nb > 1 ? " diagnostics · " : " diagnostic · ") : "Processus · ") + dept + (enCours && D.task.desc ? " · " + D.task.desc : "");
    const e = activeEpc(); const detail = $("#diag-detail"), card = $("#scr-card");
    if (detail) detail.style.display = (e || procDiags(p).length) ? "flex" : "none";
    if (card) card.style.display = e && !SCR.rec ? "none" : "flex";
    const hint = $("#scr-hint"); if (hint && !SCR.rec) hint.textContent = (e ? "Nouvel enregistrement : " : "Aucun enregistrement pour ce processus. ") + "Cliquez sur « Enregistrer l’écran », choisissez l’écran à partager, puis exécutez la tâche comme d’habitude. Le curseur est enregistré avec l’image" + (CLOUD ? " et la vidéo est envoyée dans votre espace Lens." : ".");
    const qb = $("#scr-quiz"); if (qb) { const ok = procDiags(p).some((d) => d.epc); qb.style.opacity = ok ? "1" : "0.45"; qb.title = ok ? "Répondre aux questions de Lens sur ce processus, ou corriger le diagramme" : "Disponible après la cartographie du premier enregistrement"; }
    const qp = $("#quiz-panel"); if (qp && qp.style.display !== "none") quizRender();
    renderEPC(); renderDocs();
    if (CLOUD && ME && !e && D.rec && D.rec.cloudId && !ANALYSE && !SCR.rec) { LensCloud.recording(D.rec.cloudId).then((r) => { if (r && (r.statut === "analyse" || r.statut === "televerse")) { scrStatus("Analyse en cours par Lens… Le diagramme apparaîtra ici dès qu’il sera prêt."); scrWatch(r.id); } }).catch(() => {}); }
  }
  // ─── questionnaire : entretien guidé par Lens après la cartographie, avec corrections du diagramme ───
  const QUIZ = { diag: null, busy: false };
  function quizDiag() { const p = activeProc(); const ds = procDiags(p).filter((d) => d.epc); if (!ds.length) return null; return ds.find((d) => d.name === QUIZ.diag) || ds[ds.length - 1]; }
  function quizStatus(t) { const el = $("#quiz-status"); if (el) el.textContent = t || ""; }
  function quizRender() {
    const box = $("#quiz-msgs"); const d = quizDiag(); if (!box) return;
    const p = activeProc(); const ds = procDiags(p).filter((x) => x.epc); const sel = $("#quiz-diag");
    if (sel) { sel.style.display = ds.length > 1 ? "inline-block" : "none"; sel.innerHTML = ds.map((x) => '<option' + (d && x.name === d.name ? " selected" : "") + ">" + esc(x.name) + "</option>").join(""); }
    $("#quiz-title").textContent = d ? d.name + " · " + (p ? p.title : "") : "Entretien sur le processus";
    const chat = (d && d.chat) || [];
    box.innerHTML = chat.map((m) => '<div style="align-self: ' + (m.role === "user" ? "flex-end" : "flex-start") + '; max-width: 92%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; ' + (m.role === "user" ? "background: #111113; color: #ffffff; border-bottom-right-radius: 6px" : "background: #f4f4f6; color: #111113; border-bottom-left-radius: 6px") + '">' + esc(m.content) + (m.epc_modifie ? '<div style="margin-top: 6px; font-size: 11.5px; font-weight: 600; opacity: 0.75">Diagramme mis à jour</div>' : "") + "</div>").join("") || '<div style="font-size: 13.5px; color: #5e5e65">Lens prépare sa première question…</div>';
    const f = $("#quiz-form"); if (f) f.style.display = d && d.chat_termine ? "none" : "flex";
    if (d && d.chat_termine) box.insertAdjacentHTML("beforeend", '<div style="font-size: 13px; color: #5e5e65; text-align: center; padding: 8px">Entretien terminé. Merci !</div>');
    box.scrollTop = box.scrollHeight;
  }
  async function quizCall(message) {
    const p = activeProc(); const d = quizDiag(); if (!p || !d) return;
    if (!CLOUD || !ME) { toast("Le questionnaire demande la base en ligne.", false); return; }
    QUIZ.busy = true; quizStatus("Lens réfléchit…"); const btn = $("#quiz-send"); if (btn) btn.disabled = true;
    try {
      if (cloudDirty) { clearTimeout(cloudTimer); cloudDirty = false; await LensCloud.saveSpace(ME.entreprise_id, D); }
      const r = await LensCloud.questionnaire(p.title, d.name, message);
      await reloadSpace(); quizRender();
      if (r && r.epc_modifie) { renderProcPage(); $("#quiz-panel").style.display = "flex"; quizRender(); toast("Diagramme mis à jour d’après vos précisions"); }
    } catch (e) { console.error(e); quizStatus(e.message); toast(e.message, false); }
    finally { QUIZ.busy = false; if (!$("#quiz-status").textContent.startsWith("Questionnaire")) quizStatus(""); if (btn) btn.disabled = false; }
  }
  function quizOpening() { const d = quizDiag(); if (d && !(d.chat || []).length && !QUIZ.busy) quizCall(null); }
  function quizOpen() {
    const d = quizDiag();
    if (!d) { toast("Le questionnaire s’ouvre une fois le processus cartographié : enregistrez l’écran d’abord.", false); return; }
    QUIZ.diag = d.name; $("#quiz-panel").style.display = "flex"; quizRender(); quizOpening();
    setTimeout(() => { const i = $("#quiz-input"); if (i) i.focus(); }, 100);
  }
  async function quizSend() {
    const i = $("#quiz-input"); const t = (i.value || "").trim(); if (!t || QUIZ.busy) return;
    const d = quizDiag(); if (!d) return; (d.chat = d.chat || []).push({ role: "user", content: t, ts: new Date().toISOString() }); i.value = ""; quizRender();
    await quizCall(t);
  }
  function initScreenRec() {
    if (!$("#scr-start")) return; scrUI();
    $("#scr-start").addEventListener("click", scrStart);
    $("#scr-quiz").addEventListener("click", () => quizOpen());
    $("#quiz-close").addEventListener("click", () => { $("#quiz-panel").style.display = "none"; });
    $("#quiz-diag").addEventListener("change", () => { QUIZ.diag = $("#quiz-diag").value; quizRender(); quizOpening(); });
    $("#quiz-form").addEventListener("submit", (e) => { e.preventDefault(); quizSend(); });
    $("#quiz-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); quizSend(); } });
    $("#scr-docs").addEventListener("click", () => { if (!CLOUD || !ME || !ME.entreprise_id) { toast("L’import de documents demande la base en ligne.", false); return; } $("#scr-docs-in").value = ""; $("#scr-docs-in").click(); });
    $("#scr-docs-in").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []); if (!files.length) return;
      const MAX_DOCS = 10; let existants = 0;
      try { existants = (await LensCloud.listDocuments(ME.entreprise_id, D.task.proc || D.task.name || null)).length; } catch (_) {}
      if (existants >= MAX_DOCS) { toast("Limite atteinte : " + MAX_DOCS + " documents par processus. Retirez-en un avant d’en ajouter.", false); return; }
      const place = MAX_DOCS - existants; if (files.length > place) toast("Seuls " + place + " document" + (place > 1 ? "s" : "") + " sur " + files.length + " seront importés (limite de " + MAX_DOCS + " par processus).", false);
      const ok = /\.(pdf|docx?|xlsx?|csv|pptx?|md|txt)$/i; let n = 0;
      for (const f of files.slice(0, place)) {
        if (!ok.test(f.name)) { toast("« " + f.name + " » : format non pris en charge (PDF, Word, Excel, PowerPoint, CSV, Markdown, texte).", false); continue; }
        if (f.size > 50 * 1048576) { toast("« " + f.name + " » dépasse 50 Mo.", false); continue; }
        try { await LensCloud.uploadDocument(ME.entreprise_id, f, { processus: D.task.proc || D.task.name || null, diagnostic: D.task.name || null }); n++; }
        catch (ex) { toast(ex.message, false); }
      }
      if (n) toast(n + (n > 1 ? " documents importés" : " document importé") + " · ils serviront à l’analyse du processus");
      renderDocs();
    });
    $("#scr-docs-list").addEventListener("click", async (e) => {
      const open = e.target.closest("[data-doc-open]"), del = e.target.closest("[data-doc-del]");
      if (open) { e.preventDefault(); try { const url = await LensCloud.documentUrl(open.dataset.docOpen); window.open(url, "_blank", "noopener"); } catch (ex) { toast(ex.message, false); } }
      if (del) { const ok = await dialog({ title: "Retirer ce document ?", text: del.dataset.docName, ok: "Retirer" }); if (!ok) return; try { await LensCloud.deleteDocument(del.dataset.docDel, del.dataset.docPath); toast("Document retiré"); renderDocs(); } catch (ex) { toast(ex.message, false); } }
    }); $("#scr-pause").addEventListener("click", scrPause); $("#scr-finish").addEventListener("click", scrFinish);
    window.addEventListener("beforeunload", (e) => { if (SCR.rec) { e.preventDefault(); e.returnValue = ""; } });
  }

  // ───────────────────────── écran 7 : diagnostic ─────────────────────────
  /** Une carte par département : bandeau blanc avec le nom du département, puis ses processus l'un sous l'autre. */
  function deptCard(dept, items) {
    const rows = items.map(({ p, i }) => '<button type="button" data-proc="' + i + '" style="border: none; background: transparent; color: #ffffff; text-align: left; font: inherit; cursor: pointer; width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-top: 1px solid rgba(255, 255, 255, 0.12); font-size: 16px; font-weight: 600; line-height: 1.25' + (i === D.activeProc ? "; background: rgba(255, 255, 255, 0.1)" : "") + '">' +
      '<span style="flex: none; width: 8px; height: 8px; border-radius: 50%; background: ' + (i === D.activeProc ? "#ffffff" : "rgba(255, 255, 255, 0.35)") + '"></span><span>' + esc(p.title) + '</span><span data-proc-del="' + i + '" role="button" aria-label="Supprimer le processus" title="Supprimer ce processus" style="margin-left: auto; flex: none; width: 28px; height: 28px; border-radius: 50%; background: #ffffff; color: #111113; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; line-height: 1">×</span></button>' +
      // arborescence : les diagnostics du processus, un par ligne
      (p.diagnostics || []).map((d, j) => '<button type="button" class="diag-row" data-proc="' + i + '" data-diag="' + j + '" style="border: none; background: #ffffff; color: #111113; text-align: left; font: inherit; cursor: pointer; width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 9px 20px 9px 30px; font-size: 13.5px; font-weight: 600; line-height: 1.3; border-top: 1px solid #ececef"><span style="flex: none; width: 14px; height: 14px; border-left: 1.5px solid #8a8a92; border-bottom: 1.5px solid #8a8a92; border-radius: 0 0 0 4px; margin-top: -8px"></span><span>' + esc(d.name) + '</span><span style="font-weight: 400; color: #5e5e65">' + (d.date ? new Date(d.date).toLocaleDateString("fr-CA") : "") + (d.desc ? " · " + esc(d.desc) : "") + (d.epc ? "" : " · en attente d’analyse") + "</span></button>").join("")).join("");
    return '<div data-dept-card style="border-radius: 22px; overflow: hidden; display: flex; flex-direction: column; background: ' + GRADC + '; color: #ffffff; box-shadow: 0 18px 36px -20px rgba(0, 0, 0, 0.55)">' +
      '<span style="display: flex; justify-content: space-between; align-items: center; width: 100%; box-sizing: border-box; padding: 10px 20px; background: #ffffff; color: #111113; font-size: 12px; font-weight: 700; letter-spacing: 0.08em"><span>' + esc(dept) + '</span><span style="font-weight: 600; color: #5e5e65; letter-spacing: 0">' + items.length + " processus</span></span>" +
      '<div style="display: flex; flex-direction: column; padding-bottom: 6px">' + rows + "</div></div>";
  }
  function deptGroups() {
    const groups = new Map();
    D.processes.forEach((p, i) => { const k = String(p.dept || "SANS DÉPARTEMENT").toUpperCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ p, i }); });
    return Array.from(groups.entries());
  }
  function renderProcesses() {
    const box = $("#proc-cards"); if (!box) return; box.innerHTML = deptGroups().map(([dept, items]) => deptCard(dept, items)).join("");
    const p = D.processes[D.activeProc];
    if (!p) { box.innerHTML = '<div style="grid-column: 1 / -1; border-radius: 22px; padding: 24px; background: #ffffff; text-align: center; font-size: 14px; color: #5e5e65; box-shadow: 0 24px 48px -28px rgba(17, 17, 19, 0.18)">Aucun processus. Créez votre premier diagnostic avec le bouton « Nouveau diagnostic ».</div>'; }
    const tot = $("#diagnostic .rec-total"); if (tot) { const none = !(D.rec && D.rec.total != null) && (!p || !p.recs); const txt = Array.from(tot.parentElement.childNodes).find((n) => n.nodeType === 3 && /Enregistrement|Aucun/.test(n.textContent));
      if (txt) txt.textContent = none ? "Aucun enregistrement" : "Enregistrement terminé · "; tot.style.display = none ? "none" : ""; tot.textContent = D.rec && D.rec.total != null ? mmss(D.rec.total) : "12:48"; }
    const v = $("#epc-validate"); if (v) { v.textContent = D.procValidated ? "Processus validé ✓" : "Valider le processus"; }
    if (typeof renderEPC === "function") renderEPC();
  }
  // ─── diagramme EPC construit à partir de D.epc (mêmes formes que la maquette : événement, étape, qui, documents, système) ───
  const EPC_HEX = "width: 250px; min-height: 54px; box-sizing: border-box; padding: 8px 34px; clip-path: polygon(13% 0, 87% 0, 100% 50%, 87% 100%, 13% 100%, 0 50%); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center";
  const EPC_DOC = "width: 100px; min-height: 52px; box-sizing: border-box; border: 1.5px solid #111113; border-radius: 3px 3px 16px 3px; padding: 6px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 2px";
  const EPC_LBL = "font-size: 9.5px; font-weight: 600; letter-spacing: 0.12em; color: #5e5e65";
  const epcDown = '<div style="display: flex; flex-direction: column; align-items: center"><span style="width: 1.5px; height: 22px; background: #111113"></span><span style="width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 7px solid #111113"></span></div>';
  const epcRight = '<span style="display: flex; align-items: center"><span style="width: 8px; height: 1.5px; background: #111113"></span><span style="width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 6px solid #111113"></span></span>';
  const epcLine = '<span style="width: 14px; height: 1.5px; background: #111113"></span>';
  // chaque document et chaque système a sa propre case ; une case vide propose d'en ajouter un
  const epcBox = (label, value, edit, empty) => '<div data-edit="' + edit + '" title="Modifier" style="cursor: pointer; ' + EPC_DOC + '"><span style="' + EPC_LBL + '">' + label + '</span><span style="font-size: 12px' + (empty ? "; color: #9a9aa1; font-style: italic" : "") + '">' + esc(value) + "</span></div>";
  const epcSysBox = (label, value, edit, empty) => '<div data-edit="' + edit + '" title="Modifier" style="cursor: pointer; width: 100px; min-height: 52px; box-sizing: border-box; border: 1.5px solid #111113; border-left: 6px solid #111113; padding: 6px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 2px"><span style="' + EPC_LBL + '">' + label + '</span><span style="font-size: 12px' + (empty ? "; color: #9a9aa1; font-style: italic" : "") + '">' + esc(value) + "</span></div>";
  const epcColumn = (items, label, kind, i, fabrique, empty, pre) => '<div style="display: flex; flex-direction: column; gap: 6px">' + ((items && items.length) ? items.map((x, j) => fabrique(label + " " + (j + 1), x, (pre || "") + kind + ":" + i + ":" + j, false)).join("") : fabrique(label, empty, (pre || "") + kind + ":" + i + ":new", true)) + "</div>";
  function epcStep(s, n, pre) {
    const i = n - 1; pre = pre || "";
    const who = '<div data-edit="' + pre + 'who:' + i + '" title="Modifier" style="cursor: pointer; width: 100px; min-height: ' + (s.dept ? 92 : 74) + 'px; box-sizing: border-box; border: 1.5px solid #6b6b72; border-radius: 50%; padding: 8px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px"><span style="font-size: 10px; font-weight: 600; letter-spacing: 0.14em; color: #5e5e65">QUI</span><span style="font-size: 10.5px; font-weight: 600; padding: 2px 7px; border: 1px solid #6b6b72; border-radius: 999px; white-space: nowrap">' + esc(s.who || "—") + "</span>" + (s.dept ? '<span style="font-size: 10.5px; font-weight: 600; padding: 2px 7px; border: 1px solid #6b6b72; border-radius: 999px; white-space: nowrap">' + esc(s.dept) + "</span>" : "") + "</div>";
    const step = '<div data-fiche="' + pre + n + '" data-edit="' + pre + 'step:' + i + '" title="Fiche de données · en mode Modifier : éditer l’étape" style="cursor: pointer; width: 150px; min-height: 64px; box-sizing: border-box; border-radius: 10px; padding: 8px 10px; background: ' + GRADC + '; color: #ffffff; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px' + (s.bottleneck ? "; box-shadow: 0 0 0 3px #ffffff, 0 0 0 5px #111113" : "") + '"><span style="font-size: 11px; color: #c9c9ce">Étape ' + n + '</span><b style="font-size: 13.5px; font-weight: 600; line-height: 1.2">' + esc(s.title) + "</b>" + (s.bottleneck ? '<span style="font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #ffffff; color: #111113">Goulot probable</span>' : "") + "</div>";
    return '<div style="display: flex; align-items: center">' + who + epcLine + epcColumn(s.in, "ENTRANT", "in", i, epcBox, "aucun", pre) + epcRight + step + epcRight + epcColumn(s.out, "SORTANT", "out", i, epcBox, "aucun", pre) + epcLine + epcColumn(s.sys, "SYSTÈME", "sys", i, epcSysBox, "hors écran", pre) + "</div>";
  }
  let EDIT = false, EDIT_P = null;   // mode « Modifier » du diagramme et processus concerné
  function setEdit(on) {
    EDIT = !!on; const b = $("#epc-edit"), t = $("#epc-tools"), box = $("#epc");
    if (b) { b.textContent = EDIT ? "Terminer" : "Modifier"; b.style.background = EDIT ? "#111113" : "#ffffff"; b.style.color = EDIT ? "#ffffff" : "#111113"; }
    if (t) t.style.display = EDIT ? "flex" : "none"; const del = $("#epc-delete"); if (del) del.style.display = EDIT ? "inline-block" : "none";
    if (box) box.classList.toggle("epc-editing", EDIT);
    if (EDIT) { const fp = $("#fiche-panel"); if (fp) fp.style.display = "none"; }
  }
  /** Diagramme du processus actif, créé vide s'il n'existe pas encore (processus bâti à la main). */
  function ensureEpc() { const p = activeProc(); if (!p) return null; let d = selectedDiag(p); if (!d) { d = { name: "Diagnostic 1", desc: "bâti à la main", date: new Date().toISOString(), epc: null }; (p.diagnostics = p.diagnostics || []).push(d); DIAG_SEL[p.title] = 0; }
    if (!d.epc) d.epc = { trigger: "", steps: [], source: { type: "manuel" } }; d.epc.steps = d.epc.steps || []; return d.epc; }
  /** Barre du mode « Modifier » : ajout d'une étape, d'une ressource (qui exécute), d'un intrant, d'un sortant ou d'un système. */
  function epcAdd(kind) {
    const e = ensureEpc(); if (!e) return; const steps = e.steps;
    const apres = (msg) => { const p = activeProc(); if (p) p.steps = steps.length; save(); renderProcPage(); setEdit(true); toast(msg); };
    const labels = steps.map((s, i) => "Étape " + (i + 1) + " · " + (s.title || "—"));
    if (kind === "step") {
      return dialog({ title: "Nouvelle étape", fields: [
        { name: "title", label: "Titre de l’étape", placeholder: "Ex. : Préparer la soumission" },
        { name: "dur", label: "Durée", placeholder: "Ex. : 20 min, attente 2 j" },
        { name: "who", label: "Qui exécute (ressource)", placeholder: "Personne ou rôle" },
        { name: "dept", label: "Département", combo: deptNames(), placeholder: "Facultatif" },
        { name: "pos", label: "Position", options: ["À la fin"].concat(labels.map((l) => "Après « " + l + " »")).concat(steps.length ? ["Au début"] : []) }], ok: "Ajouter" })
        .then((v) => { if (!v || !v.title) return; const st = { title: v.title, dur: v.dur || "", who: v.who || "", dept: v.dept || "", in: [], out: [], sys: [], event: "" };
          const k = v.pos === "Au début" ? 0 : v.pos === "À la fin" ? steps.length : labels.findIndex((l) => v.pos === "Après « " + l + " »") + 1;
          steps.splice(k < 0 ? steps.length : k, 0, st); apres("Étape « " + v.title + " » ajoutée"); });
    }
    if (!steps.length) { toast("Ajoutez d’abord une étape.", false); return; }
    const etape = { name: "step", label: "Étape concernée", options: labels };
    if (kind === "who") return dialog({ title: "Ressource · qui exécute", fields: [etape, { name: "who", label: "Personne ou rôle", placeholder: "Ex. : Estimateur" }, { name: "dept", label: "Département", combo: deptNames(), placeholder: "Facultatif" }], ok: "Enregistrer" })
      .then((v) => { if (!v) return; const st = steps[labels.indexOf(v.step)]; if (!st) return; st.who = v.who || ""; st.dept = v.dept || ""; apres("Ressource enregistrée"); });
    const def = { in: ["in", "Intrant", "Document ou information reçue", "Ex. : Plans.pdf, courriel du client"], out: ["out", "Sortant", "Document ou information produite", "Ex. : Soumission.pdf"], sys: ["sys", "Système", "Logiciel ou outil utilisé", "Ex. : Excel, Outlook, Procore"] }[kind]; if (!def) return;
    const [cle, titre, label, ph] = def;
    return dialog({ title: titre + " · ajouter", fields: [etape, kind === "sys" ? { name: "v", label, placeholder: ph } : { name: "v", label: label + (docNames().length ? " · tapez un nom ou choisissez un document importé" : ""), combo: docNames(), createLabel: "Utiliser", placeholder: ph }], ok: "Ajouter" })
      .then((v) => { if (!v || !v.v) return; const st = steps[labels.indexOf(v.step)]; if (!st) return; (st[cle] = Array.isArray(st[cle]) ? st[cle] : []).push(v.v); apres(titre + " ajouté"); });
  }
  /** Édition d'une case du diagramme : trigger · event:i · step:i · who:i · in:i:j · out:i:j · sys:i:j (j = new pour ajouter). */
  function epcEdit(code) {
    const parts = code.split(":"); const k = +parts.shift(); const e = ((procDiags(activeProc())[k] || {}).epc) || null; if (!e) return; const [kind, si, sj] = parts; const i = +si; const st = (e.steps || [])[i];
    const apres = () => { const p = activeProc(); if (p) p.steps = (e.steps || []).length; save(); renderEPC(); toast("Diagramme mis à jour"); };
    if (kind === "trigger") return dialog({ title: "Déclencheur", fields: [{ name: "v", label: "Événement qui lance le processus", value: e.trigger || "" }], ok: "Enregistrer" }).then((v) => { if (!v) return; e.trigger = v.v; apres(); });
    if (kind === "result") return dialog({ title: "Résultat du processus", fields: [{ name: "v", label: "Ce que le processus produit", value: e.result || "" }], ok: "Enregistrer" }).then((v) => { if (!v) return; e.result = v.v; apres(); });
    if (!st) return;
    if (kind === "event") return dialog({ title: "Événement après l’étape " + (i + 1), fields: [{ name: "v", label: "Événement", value: st.event || "" }], ok: "Enregistrer" }).then((v) => { if (!v) return; st.event = v.v; apres(); });
    if (kind === "step") return dialog({ title: "Étape " + (i + 1), text: "Videz le titre pour supprimer l’étape.", fields: [{ name: "title", label: "Titre", value: st.title || "" }, { name: "dur", label: "Durée", value: st.dur || "", placeholder: "Ex. : 20 min, attente 2 j" }, { name: "bottleneck", label: "Goulot probable", options: ["Non", "Oui"], value: st.bottleneck ? "Oui" : "Non" }], ok: "Enregistrer" })
      .then((v) => { if (!v) return; if (!v.title.trim()) { e.steps.splice(i, 1); apres(); return; } st.title = v.title.trim(); st.dur = v.dur.trim(); st.bottleneck = v.bottleneck === "Oui"; apres(); });
    if (kind === "who") return dialog({ title: "Qui exécute l’étape " + (i + 1), fields: [{ name: "who", label: "Personne ou rôle", value: st.who || "" }, { name: "dept", label: "Département", combo: deptNames(), value: st.dept || "", placeholder: "Facultatif" }], ok: "Enregistrer" })
      .then((v) => { if (!v) return; st.who = v.who.trim(); st.dept = v.dept.trim(); apres(); });
    const listes = { in: ["in", "Document entrant"], out: ["out", "Document sortant"], sys: ["sys", "Système"] }[kind]; if (!listes) return;
    const [cle, titre] = listes; st[cle] = Array.isArray(st[cle]) ? st[cle] : []; const neuf = sj === "new"; const j = neuf ? st[cle].length : +sj;
    return dialog({ title: titre + (neuf ? " · ajouter" : " " + (j + 1)) + " · étape " + (i + 1), text: neuf ? "" : "Videz le champ pour retirer cette case.", fields: [kind === "sys" ? { name: "v", label: titre, value: neuf ? "" : (st[cle][j] || ""), placeholder: "Ex. : Excel, Outlook, Procore" } : { name: "v", label: titre + (docNames().length ? " · tapez un nom ou choisissez un document importé" : ""), combo: docNames(), createLabel: "Utiliser", value: neuf ? "" : (st[cle][j] || ""), placeholder: "Ex. : Soumission.pdf, courriel du client" }], ok: "Enregistrer" })
      .then((v) => { if (!v) return; const t = v.v.trim(); if (!t) { if (!neuf) st[cle].splice(j, 1); } else if (neuf) st[cle].push(t); else st[cle][j] = t; apres(); });
  }
  function ficheLabels(s1, qui, n) {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const fl = $("#fiche-step-label"), ft = $("#fiche-step-title");
    if (fl && ft) { fl.textContent = s1 ? "ÉTAPE " + (n || 1) + " · FICHE DE DONNÉES" : "FICHE DE DONNÉES"; ft.textContent = s1 ? s1.title : "En attente d’un enregistrement"; }
    set("#fiche-in1", s1 ? ((s1.in || [])[0] || "aucun") : "—"); set("#fiche-out1", s1 ? ((s1.out || [])[0] || "aucun") : "—"); set("#fiche-sys1", s1 ? ((s1.sys || [])[0] || "hors écran") : "—");
    set("#fiche-role", s1 ? (s1.who || "—") + (s1.dept ? " · " + s1.dept : "") : "—");
    set("#fiche-double", s1 ? (s1.bottleneck ? "Copier-coller entre deux logiciels détecté" : "Aucune saisie double détectée pendant l’enregistrement") : "À déterminer par l’enregistrement");
    const other = $("#fiche-other"); if (other) other.style.display = "none";
    const add = $("#fiche-deps-add"); if (add) add.innerHTML = ["Ajouter…"].concat(deptNames()).map((n) => "<option>" + esc(n) + "</option>").join("");
    const av = $$("#diagnostic header span").find((x) => /^[A-ZÀ-Ý—]{1,2}$/.test(x.textContent.trim()) && /border-radius: 50%/.test(x.getAttribute("style") || ""));
    if (av) av.textContent = initials(qui || (CLOUD && ME && ME.nom) || D.company.first || "—");
  }
  function renderDiagPills() {
    const box = $("#epc-diags"); if (!box) return; const p = activeProc(); const ds = procDiags(p); const sel = selectedDiag(p);
    box.style.display = "none"; if (box) return;
    box.style.display = "flex";
    box.innerHTML = ds.map((d, i) => { const on = d === sel; const etat = d.epc ? "" : " · en attente d’analyse"; const date = d.date ? new Date(d.date).toLocaleDateString("fr-CA") : "";
      return '<button type="button" data-diag="' + i + '" title="' + esc(d.desc || "") + '" style="min-height: 34px; padding: 0 14px; border-radius: 999px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1.5px solid #111113; background: ' + (on ? "#111113" : "#ffffff") + "; color: " + (on ? "#ffffff" : "#111113") + '">' + esc(d.name) + (date ? '<span style="font-weight: 400; opacity: 0.75"> · ' + date + "</span>" : "") + esc(etat) + "</button>"; }).join("");
  }
  function renderEPC() {
    renderDiagPills();
    const box = $("#epc"); if (!box) return; const p = activeProc(); const e = activeEpc(); const fp = $("#fiche-panel"); if (fp) fp.style.display = "none"; FICHE_STEP = null; ficheClear();
    if (!p) { ficheLabels(null); return; }
    if (!e) { if (p && !p.steps && !p.recs) { ficheLabels(null); box.innerHTML = '<div style="padding: 40px 20px; text-align: center; font-size: 14px; color: #5e5e65">Aucun enregistrement pour ce processus. Cliquez sur « Enregistrer l’écran », puis importez le diagnostic produit par l’agent.</div>'; const sub = $("#epc-sub"); if (sub) sub.textContent = (p.dept || "").toUpperCase() + " · EN ATTENTE D’UN ENREGISTREMENT"; } return; }
    const diagramme = (e, pre) => {
      let h = '<div data-edit="' + pre + 'trigger" title="Modifier" style="cursor: pointer; ' + EPC_HEX + '; min-height: 58px; background: ' + GRADC + '; color: #ffffff"><span style="font-size: 10.5px; font-weight: 600; letter-spacing: 0.16em; color: #c9c9ce">DÉCLENCHEUR</span><b style="font-size: 13.5px; font-weight: 600">' + esc(e.trigger || "Début") + "</b></div>";
      (e.steps || []).forEach((st, i) => { h += epcDown + epcStep(st, i + 1, pre); });
      if ((e.steps || []).length) h += epcDown + '<div data-edit="' + pre + 'result" title="Modifier" style="cursor: pointer; ' + EPC_HEX + '; background: #e4e4e8"><span style="font-size: 10.5px; font-weight: 600; letter-spacing: 0.16em; color: #5e5e65">RÉSULTAT</span><span style="font-size: 13px">' + esc(e.result || "Terminé") + "</span></div>";
      else h += epcDown + '<div style="' + EPC_HEX + '; background: #e4e4e8"><span style="font-size: 13px">Aucune étape pour l’instant.</span></div>';
      return h;
    };
    const ds = procDiags(p); let h = "";
    ds.forEach((d, k) => {
      const date = d.date ? new Date(d.date).toLocaleDateString("fr-CA") : "";
      h += '<div style="width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: ' + (k ? "26px" : "4px") + ' 0 16px' + (k ? "; border-top: 1px solid #ececef; margin-top: 22px" : "") + '"><span style="font-size: 12.5px; font-weight: 700; padding: 6px 14px; border-radius: 999px; background: #111113; color: #ffffff">' + esc(d.name) + '</span><span style="font-size: 13px; color: #5e5e65">' + esc(date) + (d.desc ? " · " + esc(d.desc) : "") + (d.duree_s ? " · " + mmss(d.duree_s) : "") + (d.epc ? "" : " · en attente d’analyse") + "</span></div>";
      if (d.epc) h += diagramme(d.epc, k + ":");
    });
    box.innerHTML = h;
    const sub = null; const src = e.source || {};
    const dern = selectedDiag(p);
    $$("#diag-detail .task-title").forEach((el) => (el.textContent = p.title));
    if (sub) sub.textContent = ((p && p.dept) || "").toUpperCase() + (src.diagnostic || dern ? " · " + String(src.diagnostic || dern.name).toUpperCase() : "") + " · PROPOSÉ PAR LENS À PARTIR DE " + (src.clicks != null ? src.clicks + " CLICS" : "L’ENREGISTREMENT") + (src.qui ? " · " + src.qui.toUpperCase() : "") + (dern && dern.desc ? " · " + dern.desc : "");
    const s1 = (e.steps || [])[0]; ficheLabels(s1 || null, src.qui);
    $$(".side-proc-title").forEach((el) => (el.textContent = (p || {}).title || "—"));
    $$(".side-proc-sub").forEach((el) => (el.textContent = ((p && p.dept) ? p.dept[0] + p.dept.slice(1).toLowerCase() : "") + " · " + (src.qui || "1 participant")));
  }
  function ficheInputs() { return $$("#fiche input, #fiche select, #fiche textarea"); }
  // espace réel (processus importé ou neuf) : les valeurs de démonstration de la fiche sont effacées, la personne la remplit
  function ficheClear() { if (Object.keys(D.fiche).length) return; ficheInputs().forEach((inp) => { if (inp.tagName !== "SELECT") inp.value = ""; }); ficheCompute(); }
  let FICHE_STEP = null;   // étape dont la fiche est affichée
  const UNITES = { s: "s", sec: "s", secondes: "s", min: "min", minutes: "min", h: "h", heures: "h", j: "jours", jour: "jours", jours: "jours", sem: "semaines" };
  /** « 4 s », « 20 min », « 1,5 h », « attente 2 j » → { attente, valeur, unite } */
  function parseDur(d) { const m = /(attente\s*)?([\d.,]+)\s*([a-zé]+)?/i.exec(String(d || "")); if (!m) return null; return { attente: !!m[1], valeur: m[2].replace(",", "."), unite: UNITES[(m[3] || "min").toLowerCase()] || (m[3] || "min") }; }
  function ficheSetEditable(on) { ficheInputs().forEach((inp) => { inp.disabled = !on; inp.style.background = on ? "#ffffff" : "#f4f4f6"; inp.style.color = "#111113"; }); const b = $("#fiche-edit"); if (b) { b.textContent = on ? "Modification en cours" : "Modifier"; b.style.background = on ? "#111113" : "#ffffff"; b.style.color = on ? "#ffffff" : "#111113"; } const sv = $("#fiche-save"); if (sv) sv.style.display = on ? "" : "none"; }
  /** Charge la fiche d'une étape : ses valeurs enregistrées, sinon le temps de traitement (ou d'attente) déduit de la durée. */
  function ficheLoad(st) {
    FICHE_STEP = st; const ins = ficheInputs();
    ins.forEach((inp) => { if (inp.tagName !== "SELECT") inp.value = ""; });
    const row = (k) => $('#fiche .f-row[data-f="' + k + '"]');
    const remplir = (k, p) => { const r = row(k); if (!r) return; const sel = r.querySelector("select"); if (sel) sel.value = "="; const champs = $$("input", r); if (champs[0]) champs[0].value = p.valeur; if (champs.length > 3 && champs[1]) champs[1].value = ""; champs[champs.length - 2].value = p.unite; champs[champs.length - 1].value = "par exécution"; };
    const saved = st && st.fiche && Object.keys(st.fiche).length ? st.fiche : null;
    if (saved) ins.forEach((inp, i) => { if (saved[i] != null) inp.value = saved[i]; });
    else if (st) { const p = parseDur(st.dur); if (p) remplir(p.attente ? "wb" : "tt", p); }
    ficheSetEditable(false); ficheCompute();
  }
  function ficheCompute() {
    const row = (k) => $('#fiche .f-row[data-f="' + k + '"]'); const val = (k) => { const r = row(k); if (!r) return 0; const ins = $$("input", r); const a = num(ins[0].value); const b = ins.length > 3 ? num(ins[1].value) : a; return (a + b) / 2; };
    const unitOf = (k) => { const r = row(k); if (!r) return ""; const ins = $$("input", r); return (ins[ins.length - 2].value || "").toLowerCase(); };
    const toDays = (v, u) => /^s/.test(u) ? v / 3600 / (D.company.day || 8) : /min/.test(u) ? v / 60 / (D.company.day || 8) : /^h/.test(u) ? v / (D.company.day || 8) : /sem/.test(u) ? v * 5 : v;
    const cycle = toDays(val("tt"), unitOf("tt")) + toDays(val("wb"), unitOf("wb")) + toDays(val("wa"), unitOf("wa"));
    const c = $("#f-cycle"); if (c) c.textContent = "≈ " + fr(cycle, 1) + (cycle >= 2 ? " jours" : " jour");
    const freq = val("freq"), cap = val("cap"); const util = cap ? Math.round(freq / cap * 100) : 0;
    const u = $("#f-util"); if (u) u.textContent = util + " %"; const b = $("#f-util-badge"); if (b) { b.textContent = util > 100 ? "Goulot" : util > 85 ? "À surveiller" : "OK"; b.style.background = util > 100 ? "#111113" : "transparent"; b.style.color = util > 100 ? "#fff" : "#111113"; }
    const ins = ficheInputs().filter((i) => i.tagName !== "SELECT"); const filled = ins.filter((i) => String(i.value).trim() !== "").length;
    const fc = $("#fiche-count"); if (fc) fc.textContent = filled + " / " + ins.length + " champs"; const fb = $("#fiche-bar"); if (fb) fb.style.width = Math.round(filled / ins.length * 100) + "%";
    return { cycle, util };
  }
  function initDiag() {
    if (!$("#proc-cards")) return;
    $("#proc-cards").addEventListener("click", (e) => {
      const x = e.target.closest("[data-proc-del]");
      if (x) { e.stopPropagation(); const p = D.processes[+x.dataset.procDel]; if (!p) return; const n = (p.diagnostics || []).length;
        dialog({ title: "Supprimer « " + p.title + " » ?", text: "Le processus" + (n ? ", ses " + n + " diagnostic" + (n > 1 ? "s" : "") : "") + " et ses documents importés disparaîtront de Lens. Les vidéos restent dans la base.", ok: "Supprimer" })
          .then(async (ok) => { if (!ok) return; const i = D.processes.indexOf(p); if (i >= 0) D.processes.splice(i, 1); D.activeProc = 0; save(); renderProcesses(); await purgeProcessDocs(p); toast("Processus « " + p.title + " » supprimé"); }); return; }
      const b = e.target.closest("[data-proc]"); if (!b) return; D.activeProc = +b.dataset.proc; D.procValidated = false; const p = activeProc(); if (p && b.dataset.diag != null) DIAG_SEL[p.title] = +b.dataset.diag; if (p) D.task = { name: nextDiagName(p), desc: "", dept: p.dept[0] + p.dept.slice(1).toLowerCase(), proc: p.title, freq: "", windows: [] }; save(); renderProcesses(); location.hash = "nouveau-diagnostic"; });
    $("#proc-new").addEventListener("click", () => dialog({ title: "Nouveau processus", fields: [{ name: "title", label: "Nom du processus", placeholder: "Ex. : Clôturer un chantier" }, { name: "dept", label: "Département", combo: deptNames(), placeholder: "Tapez ou choisissez un département" }], ok: "Créer" }).then((v) => { if (!v || !v.title) return; const dept = ensureDept(v.dept); if (!dept) { toast("Indiquez un département.", false); return; } D.processes.unshift({ dept: dept.toUpperCase(), ver: "v1", title: v.title, steps: 0, recs: 0 }); D.activeProc = 0; D.procValidated = false; save(); renderProcesses(); toast("Processus créé · enregistrez une tâche pour le cartographier"); }));
    // ─── mode « Modifier » : les cases deviennent éditables et une barre permet d'ajouter étape, ressource, intrant, sortant, système ───
    $("#epc-edit").addEventListener("click", () => setEdit(!EDIT));
    $("#epc-diags").addEventListener("click", (ev) => { const b = ev.target.closest("[data-diag]"); if (!b) return; const p = activeProc(); if (!p) return; DIAG_SEL[p.title] = +b.dataset.diag; renderProcPage(); });
    $("#epc-delete").addEventListener("click", () => { const p = activeProc(); if (!p) return; const n = procDiags(p).length;
      dialog({ title: "Supprimer « " + p.title + " » ?", text: "Le processus" + (n ? ", ses " + n + " diagnostic" + (n > 1 ? "s" : "") : "") + " et ses documents importés disparaîtront de Lens. Les vidéos restent dans la base.", ok: "Supprimer" })
        .then(async (ok) => { if (!ok) return; const i = D.processes.indexOf(p); if (i >= 0) D.processes.splice(i, 1); D.activeProc = 0; setEdit(false); save(); renderProcesses(); location.hash = "diagnostic"; await purgeProcessDocs(p); toast("Processus « " + p.title + " » supprimé"); }); });
    $("#epc-tools").addEventListener("click", (ev) => { const b = ev.target.closest("[data-epc-add]"); if (b) epcAdd(b.dataset.epcAdd); });
    renderEPC();
    const f = $("#fiche"); ficheSetEditable(false);
    f.addEventListener("input", (e) => { const i = ficheInputs().indexOf(e.target); if (i >= 0 && FICHE_STEP) { FICHE_STEP.fiche = FICHE_STEP.fiche || {}; FICHE_STEP.fiche[i] = e.target.value; } ficheCompute(); });
    $("#fiche-edit").addEventListener("click", () => { const on = $("#fiche-save").style.display === "none"; ficheSetEditable(on); if (on) { const first = ficheInputs().find((x) => x.tagName === "INPUT" && !x.disabled); if (first) first.focus(); } });
    $("#fiche-save").addEventListener("click", (ev) => { ev.preventDefault();
      if (FICHE_STEP) { const r0 = $('#fiche .f-row[data-f="tt"]'); const ch = r0 ? $$("input", r0) : []; const v = ch[0] && ch[0].value.trim(); const u = ch[ch.length - 2] && ch[ch.length - 2].value.trim();
        if (v) { const abr = { s: "s", sec: "s", secondes: "s", seconde: "s", minutes: "min", minute: "min", heures: "h", heure: "h", jours: "j", jour: "j", j: "j" }[(u || "").toLowerCase()] || u || "min"; FICHE_STEP.dur = v + " " + abr; } }
      save(); ficheSetEditable(false); const r = ficheCompute(); renderEPC(); const fp = $("#fiche-panel"); if (fp) fp.style.display = "flex"; toast("Fiche enregistrée · cycle ≈ " + fr(r.cycle, 1) + " j · utilisation " + r.util + " %"); });
    $("#epc").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-edit]");
      if (EDIT) { if (b) epcEdit(b.dataset.edit); return; }
      const f = ev.target.closest("[data-fiche]"); if (!f) return;
      const [fk, fn] = f.dataset.fiche.split(":"); const e = ((procDiags(activeProc())[+fk] || {}).epc) || null; const i = +fn - 1; const st = e && e.steps ? e.steps[i] : null; if (!st) return;
      ficheLabels(st, (e.source || {}).qui, i + 1); ficheLoad(st);
      const fp = $("#fiche-panel"); if (fp) { fp.style.display = "flex"; fp.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    $("#fiche-close").addEventListener("click", () => { const fp = $("#fiche-panel"); if (fp) fp.style.display = "none"; });
    $("#diag-new").addEventListener("click", (e) => { e.preventDefault(); dialog({ title: "Nouveau diagnostic", fields: [
        { name: "proc", label: "Processus", combo: D.processes.map((p) => p.title), placeholder: "Tapez ou choisissez un processus" },
        { name: "desc", label: "Description du diagnostic", type: "textarea", placeholder: "Ex. : soumission du projet Laval, cas d’un client récurrent…" },
        { name: "dept", label: "Département (pour un nouveau processus)", combo: deptNames(), placeholder: "Tapez ou choisissez un département" }], text: "Le numéro du diagnostic est attribué automatiquement : Diagnostic 1, 2, 3… pour chaque processus.", ok: "Créer" })
      .then((v) => {
        if (!v) return;
        const procName = String(v.proc || "").trim(); if (!procName) { toast("Indiquez le processus de ce diagnostic.", false); return; }
        let p = D.processes.find((x) => x.title.toLowerCase() === procName.toLowerCase());
        if (!p) { const dept = ensureDept(v.dept); if (!dept) { toast("Indiquez le département du nouveau processus « " + procName + " ».", false); return; }
          p = { dept: dept.toUpperCase(), ver: "v1", title: procName, steps: 0, recs: 0, epc: null }; D.processes.unshift(p); toast("Processus « " + procName + " » créé"); }
        D.activeProc = D.processes.indexOf(p); D.procValidated = false;
        D.task = { name: nextDiagName(p), desc: String(v.desc || "").trim(), dept: p.dept[0] + p.dept.slice(1).toLowerCase(), proc: p.title, freq: "", windows: [] }; D.rec = null;
        save(); applyTask(); renderProcesses(); location.hash = "nouveau-diagnostic"; toast(D.task.name + " · " + p.title + " · enregistrez l’écran"); }); });
    ficheCompute(); renderProcesses();
  }

  // ───────────────────────── diagramme des utilisateurs (tableau de bord) ─────────────────────────
  function initStruct() { const b = $("#struct-edit"); if (b) b.addEventListener("click", () => { location.hash = "departements"; }); }
  function initNotifs() { $$(".notif-btn").forEach((b) => b.addEventListener("click", () => { const pending = D.users.filter((u) => u.status === "sent").length; const todo = D.users.filter((u) => u.status === "todo").length;
    const items = [pending + " invitation" + (pending > 1 ? "s" : "") + " en attente de réponse", todo ? todo + " employé" + (todo > 1 ? "s" : "") + " encore à inviter" : null, D.rec && D.rec.running ? "Un enregistrement est en cours (" + mmss(D.rec.elapsed) + ")" : null, !activeProc() ? "Aucun diagnostic pour l’instant" : D.procValidated ? "Processus « " + activeProc().title + " » validé" : "Le processus « " + activeProc().title + " » attend votre validation"].filter(Boolean);
    if (!items.length) items.push("Rien à signaler.");
    dialog({ title: "Notifications", text: items.map((s) => "• " + s).join("\n"), ok: "Fermer" }); $("#dlg-text").style.whiteSpace = "pre-line"; })); }

  // ───────────────────────── écran 9 : tableau de bord ─────────────────────────
  // ─── tableau de bord : tout est calculé à partir des données de l'espace (aucune valeur figée) ───
  const allEpcSteps = () => D.processes.flatMap((p) => ((latestEpc(p) || {}).steps) || []);
  const allSystems = () => { const m = new Map(); allEpcSteps().forEach((st) => (st.sys || []).forEach((x) => m.set(x, (m.get(x) || 0) + 1))); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); };
  function renderSys() {
    const box = $("#dash-sysmap"); if (!box) return; const sys = allSystems();
    const seg = (on, off) => { if (!on || !off) return; on.style.background = "#111113"; on.style.color = "#fff"; off.style.background = "transparent"; off.style.color = "#111113"; };
    seg($(D.sysMode === "cost" ? "#sys-cost" : "#sys-usage"), $(D.sysMode === "cost" ? "#sys-usage" : "#sys-cost"));
    if (!sys.length) { box.innerHTML = '<span style="font-size: 14px; color: #5e5e65; text-align: center">Aucun système observé pour l’instant : ils apparaissent avec le premier processus cartographié.</span>'; return; }
    const max = sys[0][1];
    box.innerHTML = sys.map(([n, c]) => { const size = 72 + Math.round(88 * (c / max)); const dark = c === max; return '<div title="' + esc(n) + '" style="width: ' + size + 'px; height: ' + size + 'px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8px; box-sizing: border-box; ' + (dark ? "background: " + GRADC + "; color: #ffffff" : "border: 1.5px solid #111113; background: #ffffff; color: #111113") + '"><b style="font-size: ' + (dark ? 15 : 13) + 'px; line-height: 1.15">' + esc(n) + '</b><span style="font-size: 11px; opacity: 0.75">' + (D.sysMode === "cost" ? "coût à renseigner" : c + (c > 1 ? " étapes" : " étape")) + "</span></div>"; }).join("");
  }
  const objLabel = (o) => (o.cat || "").toUpperCase();
  function renderDashGlobal() {
    const g = $("#dash-global"); if (!g) return; const sel = $("#dash-obj");
    if (sel) { sel.innerHTML = D.objectives.map((o) => "<option>" + esc(o.title) + "</option>").join("") || "<option>Aucun objectif</option>"; sel.selectedIndex = Math.min(D.dashObj, Math.max(0, D.objectives.length - 1)); }
    const o = D.objectives[D.dashObj] || D.objectives[0]; const sp = $$(":scope > span, :scope > b", g);
    if (!o) { sp[0].textContent = "OBJECTIF GLOBAL"; sp[1].textContent = "—"; sp[2].textContent = "Aucun objectif global pour l’instant."; sp[3].textContent = "À définir dans Objectifs"; return; }
    sp[0].textContent = "OBJECTIF GLOBAL · " + objLabel(o); sp[1].textContent = o.target || "—"; sp[2].textContent = o.title; sp[3].textContent = o.horizon ? "Horizon " + o.horizon : "Réel à mesurer";
  }
  function renderDash() {
    if (!$("#dash-proc")) return;
    const steps = allEpcSteps(); const goulots = steps.filter((st) => st.bottleneck).length; const sys = allSystems().length;
    const mapped = D.processes.filter((p) => (latestEpc(p) || { steps: [] }).steps.length).length, total = D.processes.length;
    $("#dash-proc").textContent = total; $("#dash-goulots").textContent = goulots; $("#dash-sys").textContent = sys;
    $("#dash-objs").textContent = D.objectives.length + (D.objectives.length > 1 ? " objectifs" : " objectif");
    const cov = total ? Math.round(mapped / total * 100) : 0;
    $("#dash-cov").textContent = cov + " %"; $("#dash-cov-bar").style.width = cov + "%";
    $("#dash-cov-text").textContent = total ? mapped + " processus cartographié" + (mapped > 1 ? "s" : "") + " sur " + total + " identifié" + (total > 1 ? "s" : "") : "Aucun processus cartographié pour l’instant.";
    // indice de santé : part des étapes sans goulot, pondérée par la couverture ; « — » tant qu'il n'y a rien à mesurer
    const sante = steps.length ? Math.round(100 * (1 - goulots / steps.length) * (0.5 + cov / 200)) : null;
    $("#dash-health").textContent = sante == null ? "—" : sante + " %"; const ring = $("#dash-ring"); if (ring) ring.setAttribute("stroke-dasharray", Math.round(138 * (sante || 0) / 100) + " 138");
    const empty = $("#dash-cols-empty"); if (empty) empty.style.display = $$("#dash-cols article").length ? "none" : "block";
    const badge = $("#dash-tree-badge"); if (badge) badge.textContent = "ORGANIGRAMME · " + D.departments.length + " DÉPARTEMENT" + (D.departments.length > 1 ? "S" : "") + (totalEmployees() ? " · " + totalEmployees() + " EMPLOYÉ" + (totalEmployees() > 1 ? "S" : "") : "");
    const tree = $("#dash-tree"); if (tree) tree.innerHTML = treeHTML() || '<p style="margin: 0; border-radius: 20px; padding: 24px; background: #f4f4f6; text-align: center; font-size: 14px; color: #5e5e65">Aucun département pour l’instant. Créez votre structure avec « Modifier la structure ».</p>';
    const p = activeProc();
    $$(".side-proc-title").forEach((el) => { const card = el.parentElement; if (card) card.style.display = p ? "flex" : "none"; });
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#dash-sys-n", sys); set("#dash-sys-double", goulots); set("#dash-sys-steps", steps.length);
    set("#dash-avatar", initials((CLOUD && ME && ME.nom) || D.company.first || "—"));
    renderSys(); renderDashGlobal();
  }
  function applyReal() { Object.keys(D.realOverrides).forEach((k) => { const a = $$('#tableau .ind[data-ind="' + CSS.escape(k) + '"]')[0]; if (!a) return; const r = D.realOverrides[k]; const dark = $$("div", a).find((d) => /RÉEL/.test(d.textContent) && /radial-gradient/.test(d.getAttribute("style") || "")); if (dark) { const b = dark.querySelector("b"); if (b) b.textContent = r.value; const units = $$("span > span", dark).filter((s) => /rgba\(255, 255, 255, 0.14\)/.test(s.getAttribute("style") || "")); if (units[0] && r.unit) units[0].textContent = r.unit; } }); }
  // Écart défavorable pour l'entreprise → case en rouge. Un indicateur « plus bas = mieux » (délai, heures, coût…) est en
  // défaut quand l'écart est positif ; les autres (profitabilité, escompte…) quand il est négatif.
  const RED = "#c62828", RED_BG = "#fdecea";
  function paintGaps() {
    $$("#tableau .ind").forEach((a) => {
      const box = $$("div", a).find((d) => /^ÉCART/.test(d.textContent.trim())); if (!box) return; const b = box.querySelector("b"); if (!b) return;
      const txt = b.textContent.trim(); if (!/^[−\-+]?\d/.test(txt)) return;
      const lowerBetter = /délai|heure|écart|coût|cout|attente|temps|charge|retard|erreur|rebut/i.test(a.dataset.ind || "");
      const bad = lowerBetter ? /^\+/.test(txt) : /^[−\-]/.test(txt);
      const lab = box.querySelector("span"); const chips = $$(":scope > span > span", box);
      if (bad) { box.style.borderColor = RED; box.style.background = RED_BG; box.title = "Écart défavorable pour l’entreprise"; if (lab) lab.style.color = RED; b.style.background = RED; b.style.color = "#ffffff"; chips.forEach((c) => { c.style.background = "#ffffff"; c.style.color = RED; }); }
      else { box.style.borderColor = "#111113"; box.style.background = ""; box.title = ""; if (lab) lab.style.color = "#3a3a3f"; b.style.background = "#111113"; b.style.color = "#ffffff"; chips.forEach((c) => { c.style.background = "#f1f1f3"; c.style.color = ""; }); }
    });
  }
  // ─── Gantt des projets d'amélioration continue ───
  const MONTHS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  const ym = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  const ymIdx = (k) => { const [y, m] = k.split("-").map(Number); return y * 12 + (m - 1); };
  const addMonths = (k, n) => { const i = ymIdx(k) + n; return Math.floor(i / 12) + "-" + String((i % 12) + 1).padStart(2, "0"); };
  function prjDates(p) {   // projets anciens ou créés sans dates : 3 mois à partir de ce mois-ci (terminé : les 3 derniers mois)
    if (!/^\d{4}-\d{2}$/.test(p.start || "")) p.start = p.status === "Terminé" ? addMonths(ym(new Date()), -3) : ym(new Date());
    if (!/^\d{4}-\d{2}$/.test(p.end || "") || ymIdx(p.end) < ymIdx(p.start)) p.end = addMonths(p.start, p.status === "Terminé" ? 2 : 3);
    return p;
  }
  function renderGantt() {
    const g = $("#gantt"); if (!g) return;
    if (!D.projects.length) { g.innerHTML = '<div style="border-radius: 20px; padding: 24px; background: #f4f4f6; text-align: center; font-size: 14px; color: #5e5e65">Aucun projet d’amélioration pour l’instant. Ajoutez-en un avec « + Projet ».</div>'; return; }
    D.projects.forEach(prjDates); save();
    const now = new Date(); const today = ym(now);
    let first = Math.min(ymIdx(today), ...D.projects.map((p) => ymIdx(p.start))), last = Math.max(ymIdx(today), ...D.projects.map((p) => ymIdx(p.end)));
    if (last - first + 1 < 6) last = first + 5; if (last - first + 1 > 18) first = last - 17;
    const n = last - first + 1; const months = Array.from({ length: n }, (_, i) => first + i);
    const LABEL = "240px";
    const head = '<div style="display: grid; grid-template-columns: ' + LABEL + ' minmax(0, 1fr); gap: 16px; align-items: end; padding: 0 0 10px"><span style="font-size: 12.5px; color: #5e5e65">Projet</span><div style="display: grid; grid-template-columns: repeat(' + n + ', minmax(0, 1fr))">' +
      months.map((m) => '<span style="font-size: 12px; color: #5e5e65; text-align: center; border-left: 1px solid #ececef; padding: 2px 0">' + MONTHS_FR[m % 12] + (m % 12 === 0 || m === first ? '<br><b style="color: #111113">' + Math.floor(m / 12) + "</b>" : "") + "</span>").join("") + "</div></div>";
    const todayPct = ((ymIdx(today) - first + (now.getDate() - 1) / 31) / n) * 100;
    const rows = D.projects.map((p, i) => {
      const a = Math.max(0, ymIdx(p.start) - first), b = Math.min(n, ymIdx(p.end) - first + 1); const left = (a / n) * 100, width = Math.max(((b - a) / n) * 100, 3);
      let bar;
      if (p.status === "Terminé") bar = "background: #c9c9ce; color: #111113";
      else if (p.status === "En cours") bar = "background: " + GRADC + "; color: #ffffff; box-shadow: 0 10px 20px -12px rgba(0, 0, 0, 0.6)";
      else bar = "background: #ffffff; color: #111113; border: 1.5px solid #111113";
      let prog = "";
      if (p.status === "En cours") { const pct = Math.max(0, Math.min(100, ((todayPct - left) / width) * 100)); prog = '<span style="position: absolute; left: 0; top: 0; bottom: 0; width: ' + pct.toFixed(1) + '%; border-radius: 12px; background: rgba(255, 255, 255, 0.18)"></span>'; }
      return '<div style="display: grid; grid-template-columns: ' + LABEL + ' minmax(0, 1fr); gap: 16px; align-items: center; padding: 10px 0; border-top: 1px solid #ececef"><span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><b style="font-size: 14px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap" title="' + esc(p.name) + '">' + esc(p.name) + '</b><span style="font-size: 12px; color: #5e5e65">' + esc(p.dept) + " · " + esc(p.resp) + '</span></span><div style="position: relative; height: 40px; background: repeating-linear-gradient(90deg, #ececef 0 1px, transparent 1px calc(100% / ' + n + '))"><span style="position: absolute; top: 0; bottom: 0; left: ' + todayPct.toFixed(2) + '%; width: 1.5px; background: #111113; opacity: 0.6"></span><button type="button" data-gantt="' + i + '" title="' + esc(p.name + " · " + p.status + " · " + p.start + " → " + p.end) + '" style="position: absolute; top: 5px; height: 30px; left: ' + left.toFixed(2) + "%; width: " + width.toFixed(2) + '%; box-sizing: border-box; border: none; border-radius: 12px; padding: 0 12px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; overflow: hidden; white-space: nowrap; ' + bar + '">' + prog + '<span style="position: relative">' + esc(p.gain) + '</span><span style="position: relative; font-weight: 500; opacity: 0.8">' + esc(p.status) + "</span></button></div></div>";
    }).join("");
    g.innerHTML = head + rows;
  }
  function initDash() {
    if (!$("#dash-period")) return; $("#dash-period").value = D.period;
    $("#dash-period").addEventListener("change", (e) => { D.period = e.target.value; save(); toast("Période : " + D.period); });
    $("#dash-obj").addEventListener("change", (e) => { D.dashObj = e.target.selectedIndex; save(); renderDashGlobal(); });
    $("#sys-usage").addEventListener("click", () => { D.sysMode = "usage"; save(); renderSys(); }); $("#sys-cost").addEventListener("click", () => { D.sysMode = "cost"; save(); renderSys(); });
    $("#dash-ind-add").addEventListener("click", () => dialog({ title: "Nouvel indicateur", fields: [{ name: "dept", label: "Département", options: deptNames() }, { name: "name", label: "Indicateur" }, { name: "target", label: "Cible", placeholder: "Ex. : 5 j / dossier" }, { name: "desc", label: "Pourquoi il compte", type: "textarea" }], ok: "Ajouter" }).then((v) => { if (!v || !v.name) return; D.indicators.push(v); save(); addDashInd(v); renderDash(); toast("Indicateur ajouté au tableau de bord"); }));
    $("#dash-cols").addEventListener("click", (e) => { const b = e.target.closest(".ind-plus"); if (!b) return; const art = b.closest(".ind"); const name = art.dataset.ind;
      dialog({ title: "Nouvelle mesure · " + name, text: "Saisissez la valeur réelle observée sur la période.", fields: [{ name: "value", label: "Valeur réelle" }, { name: "unit", label: "Unité", placeholder: "%, jours, h…" }, { name: "src", label: "Source", options: ["Mesurée", "Estimée", "Donnée système"] }], ok: "Enregistrer" }).then((v) => { if (!v || !v.value) return; D.realOverrides[name] = v; save(); applyReal(); toast("Mesure enregistrée pour « " + name + " »"); }); });
    $("#gantt").addEventListener("click", (e) => { const b = e.target.closest("[data-gantt]"); if (!b) return; const p = D.projects[+b.dataset.gantt]; if (!p) return;
      dialog({ title: p.name, text: p.dept + " · " + p.resp + " · gain visé " + p.gain, fields: [{ name: "status", label: "Statut", options: ["À faire", "En cours", "Terminé"], value: p.status }, { name: "start", label: "Début", type: "month", value: p.start }, { name: "end", label: "Fin", type: "month", value: p.end }], ok: "Enregistrer" })
        .then((v) => { if (!v) return; p.status = v.status; if (v.start) p.start = v.start; if (v.end) p.end = v.end; prjDates(p); save(); renderGantt(); renderProjects(); toast("Projet mis à jour"); }); });
    $("#gantt-add").addEventListener("click", () => newProjectDialog().then((ok) => { if (ok) renderGantt(); }));
    $$("#tableau nav > div:last-child").forEach((card) => { if (/Diagnostic en cours/.test(card.textContent)) { card.style.cursor = "pointer"; card.addEventListener("click", () => { location.hash = "diagnostic"; }); } });
    D.indicators.forEach(addDashInd); applyReal(); paintGaps(); renderGantt(); renderDash();
  }
  function addDashInd(v) {
    const cols = $("#dash-cols"); if (!cols) return; let col = $$(":scope > div", cols).find((c) => c.textContent.trim().toUpperCase().startsWith(v.dept.toUpperCase()));
    const art = '<article class="ind" data-ind="' + esc(v.name) + '" style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-top: 1px solid #ececef"><div style="display: flex; justify-content: space-between; align-items: center; gap: 8px"><b style="font-size: 14px">' + esc(v.name) + '</b><button type="button" class="ind-plus" aria-label="Ajouter une mesure" style="flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid #111113; background: #ffffff; font: inherit; font-weight: 700; cursor: pointer">+</button></div><p style="margin: 0; font-size: 12px; line-height: 1.45; color: #5e5e65">' + esc(v.desc || "Indicateur ajouté manuellement.") + '</p><div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px">' + (v.target ? '<div style="border-radius: 12px; padding: 9px 10px; background: #e4e4e8; display: flex; flex-direction: column; gap: 6px"><span style="font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; color: #3a3a3f">CIBLE</span><span style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px"><b style="font-size: 11.5px; padding: 3px 8px; border-radius: 999px; background: #ffffff">' + esc(v.target) + "</b></span></div>" : '<div style="border-radius: 12px; padding: 8px 9px; border: 1.5px dashed #b9b9bf; display: flex; flex-direction: column; gap: 6px"><span style="font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; color: #5e5e65">CIBLE</span><span style="font-size: 11px; font-style: italic; color: #5e5e65">aucune cible fixée</span></div>') + '<div style="border-radius: 12px; padding: 8px 9px; border: 1.5px dashed #b9b9bf; display: flex; flex-direction: column; gap: 6px"><span style="font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; color: #5e5e65">ÉCART</span><span style="font-size: 11px; font-style: italic; color: #5e5e65">en attente du réel</span></div></div><div style="border-radius: 12px; padding: 9px 10px; background: ' + GRADC + '; color: #ffffff; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px"><span style="display: flex; flex-direction: column; gap: 6px"><span style="font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; color: #c9c9ce">RÉEL</span><span style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px"><b style="font-size: 11.5px; padding: 3px 8px; border-radius: 999px; background: #ffffff; color: #111113">—</b><span style="font-size: 11px; padding: 3px 7px; border-radius: 999px; background: rgba(255, 255, 255, 0.14)">à mesurer</span></span></span></div></article>';
    if (col) { col.querySelector("div > div:last-child, div").parentNode; $$(":scope > div > div", col)[0].insertAdjacentHTML("beforeend", art); const cnt = $$(":scope > div > div > div:first-child > span", col)[0]; if (cnt) cnt.textContent = $$("article", col).length + " indicateurs"; }
    else cols.insertAdjacentHTML("beforeend", '<div style="display: flex; flex-direction: column; align-items: stretch"><span style="align-self: center; width: 1.5px; height: 20px; background: #111113"></span><div style="background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #e4e4e8; display: flex; flex-direction: column"><div style="background: ' + GRADC + '; color: #ffffff; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.1em">' + esc(v.dept.toUpperCase()) + '<span style="font-size: 11.5px; font-weight: 500; letter-spacing: 0; color: #c9c9ce">1 indicateur</span></div>' + art.replace("; border-top: 1px solid #ececef", "") + "</div></div>");
  }

  // ───────────────────────── écrans 10 à 12 : analyses, projets, paramètres ─────────────────────────
  function insights() {
    const e = activeEpc(); if (!e || !e.constats || !e.constats.length) return [];
    return e.constats.map((c) => ({ t: c.titre, d: c.detail, gain: c.gain || "à estimer", dept: c.dept || (activeProc() || {}).dept || "", pri: c.gravite === "forte" ? 1 : c.gravite === "moyenne" ? 2 : 3 })).sort((a, b) => a.pri - b.pri);
  }
  function renderIA() {
    const box = $("#ia-list"); if (!box) return; const items = insights(); $("#ia-count").textContent = items.length + " constat" + (items.length > 1 ? "s" : "");
    if (!items.length) { box.innerHTML = '<div style="grid-column: 1 / -1; border-radius: 20px; padding: 24px; background: #f4f4f6; text-align: center; font-size: 14px; color: #5e5e65">Aucun constat pour l’instant : les analyses apparaissent après la cartographie d’un enregistrement.</div>'; $("#ia-plan").innerHTML = ""; return; }
    box.innerHTML = items.map((it, i) => '<div style="border-radius: 20px; padding: 18px; display: flex; flex-direction: column; gap: 8px; ' + (it.pri === 1 ? "background: " + GRADC + "; color: #fff" : "background: #f4f4f6") + '"><div style="display: flex; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; ' + (it.pri === 1 ? "color: #c9c9ce" : "color: #5e5e65") + '"><span>PRIORITÉ ' + it.pri + "</span><span>" + esc(it.dept.toUpperCase()) + '</span></div><b style="font-size: 15px">' + esc(it.t) + '</b><span style="font-size: 13px; line-height: 1.45; ' + (it.pri === 1 ? "color: #d4d4d8" : "color: #5e5e65") + '">' + esc(it.d) + '</span><div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px"><b style="font-size: 14px">' + esc(it.gain) + '</b><button type="button" data-mkprj="' + i + '" style="min-height: 34px; padding: 0 12px; border-radius: 999px; border: none; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; ' + (it.pri === 1 ? "background: #fff; color: #111113" : "background: #111113; color: #fff") + '">Créer un projet</button></div></div>').join("");
    const plan = $("#ia-plan"); plan.innerHTML = items.map((it, i) => '<li style="display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid #ececef; font-size: 14px"><b style="width: 34px; height: 34px; border-radius: 50%; background: ' + (i === 0 ? "#111113" : "#e4e4e8") + "; color: " + (i === 0 ? "#fff" : "#111113") + '; display: flex; align-items: center; justify-content: center">' + (i + 1) + '</b><span><b style="font-weight: 600">' + esc(it.t) + '</b><span style="display: block; font-size: 12.5px; color: #5e5e65">' + esc(it.dept) + " · " + esc(it.gain) + '</span></span><span style="font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: #f1f1f3">' + (i < 2 ? "30 jours" : i < 4 ? "60 jours" : "90 jours") + "</span></li>").join("");
  }
  function initIA() { if (!$("#ia-list")) return; renderIA();
    $("#ia-refresh").addEventListener("click", () => { toast("Analyse des données en cours…"); setTimeout(() => { renderIA(); toast("Analyses régénérées à partir des données actuelles"); }, 900); });
    $("#ia-list").addEventListener("click", (e) => { const b = e.target.closest("[data-mkprj]"); if (!b) return; const it = insights()[+b.dataset.mkprj]; if (D.projects.some((p) => p.name === it.t)) { toast("Un projet existe déjà pour ce constat.", false); return; } D.projects.unshift({ name: it.t, dept: it.dept, resp: (D.departments.find((d) => d.name === it.dept) || {}).resp || D.company.first, gain: it.gain, status: "À faire" }); save(); renderProjects(); toast("Projet créé · voir l’onglet Projets"); });
    $("#ia-export").addEventListener("click", () => { download("lens-feuille-de-route.csv", "﻿Priorité;Constat;Département;Gain visé;Horizon\n" + insights().map((it, i) => [it.pri, it.t, it.dept, it.gain, i < 2 ? "30 jours" : i < 4 ? "60 jours" : "90 jours"].map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(";")).join("\n"), "text/csv;charset=utf-8"); toast("Feuille de route exportée"); });
  }
  let prjFilter = "";
  function renderProjects() {
    const body = $("#prj-body"); if (!body) return; const rows = D.projects.map((p, i) => ({ p, i })).filter(({ p }) => !prjFilter || p.status === prjFilter);
    body.innerHTML = rows.length ? rows.map(({ p, i }) => '<tr style="border-top: 1px solid #ececef"><td style="padding: 11px 8px 11px 0"><b style="font-weight: 600">' + esc(p.name) + '</b></td><td style="padding: 11px 8px">' + esc(p.dept) + '</td><td style="padding: 11px 8px">' + esc(p.resp) + '</td><td style="padding: 11px 8px">' + esc(p.gain) + '</td><td style="padding: 11px 8px"><select data-st="' + i + '" style="height: 34px; border-radius: 999px; border: 1.5px solid #dcdce0; background: #fff; font: inherit; font-size: 12.5px; font-weight: 600; padding: 0 10px">' + ["À faire", "En cours", "Terminé"].map((s) => "<option" + (s === p.status ? " selected" : "") + ">" + s + "</option>").join("") + '</select></td><td style="padding: 11px 0 11px 8px; text-align: right"><button type="button" data-prjdel="' + i + '" aria-label="Supprimer" style="width: 32px; height: 32px; border-radius: 50%; border: none; background: #f1f1f3; font: inherit; cursor: pointer">×</button></td></tr>').join("") : '<tr><td colspan="6" style="padding: 16px 0; color: #5e5e65; font-size: 13.5px">Aucun projet dans ce filtre.</td></tr>';
  }
  function initProjects() { if (!$("#prj-body")) return; renderProjects();
    $("#prj-filters").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; prjFilter = b.dataset.filter; $$("button", $("#prj-filters")).forEach((x) => { x.style.background = x === b ? "#111113" : "#f1f1f3"; x.style.color = x === b ? "#fff" : "#111113"; }); renderProjects(); });
    $("#prj-body").addEventListener("change", (e) => { const s = e.target.closest("[data-st]"); if (!s) return; D.projects[+s.dataset.st].status = s.value; save(); toast("Statut mis à jour"); renderProjects(); });
    $("#prj-body").addEventListener("click", (e) => { const b = e.target.closest("[data-prjdel]"); if (!b) return; D.projects.splice(+b.dataset.prjdel, 1); save(); renderProjects(); toast("Projet supprimé"); });
    $("#prj-add").addEventListener("click", () => newProjectDialog());
  }
  function newProjectDialog() {
    const start = ym(new Date());
    return dialog({ title: "Nouveau projet", fields: [{ name: "name", label: "Projet" }, { name: "dept", label: "Département", options: deptNames() }, { name: "resp", label: "Responsable" }, { name: "gain", label: "Gain visé", placeholder: "Ex. : 6 h / sem" }, { name: "start", label: "Début", type: "month", value: start }, { name: "end", label: "Fin", type: "month", value: addMonths(start, 3) }], ok: "Créer" })
      .then((v) => { if (!v || !v.name) return false; D.projects.unshift(prjDates({ name: v.name, dept: v.dept, resp: v.resp || (D.departments.find((d) => d.name === v.dept) || {}).resp || "", gain: v.gain || "à estimer", status: "À faire", start: v.start, end: v.end })); save(); renderProjects(); toast("Projet créé"); return true; });
  }
  function initSettings() {
    if (!$("#set-save")) return; const f = { name: $("#set-name"), sector: $("#set-sector"), size: $("#set-size"), email: $("#set-email"), first: $("#set-first"), day: $("#set-day") };
    const fill = () => { f.name.value = D.company.name; f.sector.value = D.company.sector; f.size.value = D.company.size; f.email.value = D.company.email; f.first.value = D.company.first; f.day.value = D.company.day;
      $("#set-stats").textContent = D.departments.length + " départements · " + totalEmployees() + " employés · " + D.users.length + " comptes · " + D.objectives.length + " objectifs · " + D.processes.length + " processus · " + D.projects.length + " projets. " + (CLOUD ? "Données dans la base en ligne de Lens (Canada), partagées par toute l’équipe." : "Données conservées dans ce navigateur seulement.");
      $("#set-account").textContent = CLOUD && ME ? (ME.email || "") + " · " + ((ME.entreprises && ME.entreprises.nom) || D.company.name) + (ME.role === "lounici" ? " · Groupe Lounici" : ME.role === "admin" ? " · administrateur·rice" : "") : D.company.email + " · connecté par le portail client de Groupe Lounici."; };
    fill();
    if (CLOUD && ME && ME.role === "lounici") {
      const card = $("#set-stats").closest("div[style*='border-radius']") || $("#set-stats").parentElement;
      card.insertAdjacentHTML("afterend", '<div style="background: #ffffff; border-radius: 28px; padding: 24px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 24px 48px -28px rgba(17, 17, 19, 0.18)"><div style="display: flex; flex-direction: column; gap: 4px"><b style="font-size: 16px">Inviter une entreprise cliente</b><span style="font-size: 13px; line-height: 1.5; color: #5e5e65">La personne invitée crée son compte et l’espace de son entreprise avec « Créer un compte » sur l’accueil de Lens. Personne d’autre ne peut en créer.</span></div>' +
        '<label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600">Entreprise<input id="inv-entreprise" placeholder="Ex. : Construction Boréal inc." style="' + INPUT + '"></label><label style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600">Courriel de la personne responsable<input id="inv-courriel" type="email" placeholder="direction@entreprise.ca" style="' + INPUT + '"></label>' +
        '<button id="inv-go" type="button" style="align-self: flex-start; min-height: 44px; padding: 0 18px; border-radius: 999px; border: none; background: #111113; color: #ffffff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer">Inviter</button><div id="inv-list" style="display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #5e5e65"></div></div>');
      const renderInv = () => LensCloud.invitations().then((rows) => { $("#inv-list").innerHTML = rows.filter((r) => r.role !== "lounici").map((r) => "<span>" + esc(r.email) + " · " + esc((r.entreprises && r.entreprises.nom) || r.entreprise_nom || "") + (r.entreprise_id ? " · espace créé" : " · en attente") + "</span>").join("") || "<span>Aucune invitation pour l’instant.</span>"; }).catch((e) => { $("#inv-list").textContent = e.message; });
      renderInv();
      $("#inv-go").addEventListener("click", async () => { const em = $("#inv-courriel").value.trim(), en = $("#inv-entreprise").value.trim(); if (!/.+@.+\..+/.test(em)) { toast("Entrez un courriel valide.", false); return; } try { await LensCloud.invite(em, en, null); toast("Invitation enregistrée pour " + em); $("#inv-courriel").value = ""; $("#inv-entreprise").value = ""; renderInv(); } catch (e) { toast(e.message, false); } });
    }
    $("#set-save").addEventListener("click", () => { D.company.name = f.name.value.trim() || D.company.name; D.company.sector = f.sector.value; D.company.size = f.size.value; D.company.email = f.email.value.trim(); D.company.first = f.first.value.trim(); D.company.day = Math.min(24, Math.max(1, parseInt(f.day.value, 10) || 8)); save(); applyCompany(); fill(); if ($("#fiche")) ficheCompute(); toast("Paramètres enregistrés"); });
    $("#set-export").addEventListener("click", () => { download("lens-" + D.company.name.replace(/[^\w]+/g, "-").toLowerCase() + ".json", JSON.stringify(D, null, 2), "application/json"); toast("Espace exporté"); });
    $("#set-import").addEventListener("click", () => pickFile(".json").then((txt) => { if (!txt) return; try { const o = JSON.parse(txt); if (!o.company) throw 0; if (!o.departments) o.departments = []; D = normalize(Object.assign(JSON.parse(JSON.stringify(DEF)), o)); save(); toast("Espace importé · rechargement"); setTimeout(() => location.reload(), 600); } catch (_) { toast("Fichier JSON invalide", false); } }));
    $("#set-reset").addEventListener("click", () => dialog({ title: "Réinitialiser la démonstration ?", text: CLOUD ? "Toutes les données de l’espace en ligne de « " + D.company.name + " » seront remplacées par celles de départ, pour toute l’équipe." : "Toutes les données saisies dans ce navigateur seront remplacées par celles de départ.", ok: "Réinitialiser" })
      .then(async (ok) => { if (!ok) return; try { localStorage.removeItem(KEY); } catch (_) {} if (CLOUD && ME && ME.entreprise_id) { try { await LensCloud.saveSpace(ME.entreprise_id, JSON.parse(JSON.stringify(DEF))); } catch (e) { toast(e.message, false); return; } } location.hash = "connexion"; location.reload(); }));
    $("#set-logout").addEventListener("click", async () => { try { sessionStorage.removeItem("portail"); } catch (_) {} if (CLOUD) { try { localStorage.removeItem(KEY); } catch (_) {} await LensCloud.signOut(); location.hash = "connexion"; location.reload(); return; } location.href = "index.html"; });
  }

  // ───────────────────────── bascules génériques Oui / Non et boutons de filtre ─────────────────────────
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.id || b.dataset.st) return; const p = b.parentElement; if (!p || p.tagName !== "SPAN") return;
    const st = p.getAttribute("style") || ""; if (!/padding: 3px; border-radius: 999px; background: #f1f1f3/.test(st)) return;
    $$("button", p).forEach((x) => { x.style.background = x === b ? "#111113" : "transparent"; x.style.color = x === b ? "#ffffff" : "#111113"; }); if ($("#fiche") && $("#fiche").contains(b)) { D.ficheSaved = false; }
  });

  // ───────────────────────── démarrage ─────────────────────────
  function refresh() { const h = location.hash.slice(1) || "connexion"; if (h === "enregistrement") renderRec(); if (h === "nouveau-diagnostic") renderProcPage(); if (h === "diagnostic") { renderProcesses(); ficheCompute(); } if (h === "objectifs") { renderObjDepts(); renderIndRows(); } if (h === "tableau") { applyCompany(); paintGaps(); renderGantt(); renderDash(); } if (h === "analyses") renderIA(); if (h === "projets") renderProjects(); if (h === "parametres") initSettings.fill && initSettings.fill(); }
  function init() {
    initConnexion(); initDepts(); renderDepts(); initUsers(); renderUsers(); initObjectives(); initTask(); initRec(); renderRec(); initScreenRec(); initDiag(); initStruct(); initNotifs(); initDash(); initIA(); initProjects(); initSettings(); applyCompany(); applyTask();
    window.addEventListener("hashchange", refresh); refresh();
    const dlg = $("#dlg"); if (dlg) dlg.addEventListener("close", () => { $("#dlg-text").style.whiteSpace = ""; });
  }
  async function boot() {
    if (CLOUD) {
      try { ME = await LensCloud.me(); } catch (e) { console.error(e); }
      if (!ME) { await LensCloud.signOut(); D = JSON.parse(JSON.stringify(DEF)); location.hash = "connexion"; window.addEventListener("hashchange", () => { if (!ME && location.hash !== "#connexion") location.hash = "connexion"; }); }
      if (ME && ME.entreprise_id) {
        try {
          const sp = await LensCloud.loadSpace(ME.entreprise_id);
          if (sp && sp.data && Object.keys(sp.data).length) { D = normalize(Object.assign(JSON.parse(JSON.stringify(DEF)), sp.data)); try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (_) {} }
          else { if (ME.entreprises && ME.entreprises.nom) D.company.name = ME.entreprises.nom; await LensCloud.saveSpace(ME.entreprise_id, D); }   // premier passage : l'espace de ce navigateur devient l'espace en ligne
        } catch (e) { console.error(e); setTimeout(() => toast("Base en ligne inaccessible : " + e.message + " · données locales affichées", false), 400); }
      }
      window.addEventListener("beforeunload", (e) => { if (cloudDirty) { e.preventDefault(); e.returnValue = ""; } });
    }
    init();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
