// Accès à la base en ligne de Lens (Supabase) : comptes, espace de l'entreprise, vidéos d'enregistrement.
// Chargé après lens-config.js. Sans configuration, LensCloud.enabled vaut false et tout reste local.
(function () {
  const cfg = window.LENS_CONFIG || {};
  const enabled = !!(cfg.url && cfg.anonKey);
  const ref = enabled ? ((/https?:\/\/([a-z0-9-]+)\./.exec(cfg.url) || [])[1] || "") : "";
  let client = null, lib = null, me = null;

  async function sb() {
    if (!enabled) throw new Error("Base en ligne non configurée");
    if (client) return client;
    lib = lib || await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    client = lib.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    return client;
  }
  const fail = (e, quoi) => { const err = new Error(quoi + " : " + (e && e.message || e)); err.cause = e; throw err; };

  window.LensCloud = {
    enabled, ref,
    /** Vrai si une session Supabase est présente dans ce navigateur (test rapide, sans réseau). */
    hasLocalSession() { try { return enabled && !!localStorage.getItem("sb-" + ref + "-auth-token"); } catch (_) { return false; } },

    // ───── comptes ─────
    async session() { const c = await sb(); const { data } = await c.auth.getSession(); return data.session || null; },
    async signIn(email, password) { const c = await sb(); const { data, error } = await c.auth.signInWithPassword({ email: String(email).trim().toLowerCase(), password }); if (error) fail(error, "Connexion refusée"); me = null; return data.user; },
    async signOut() { me = null; try { const c = await sb(); await c.auth.signOut(); } catch (_) {} },
    async resetPassword(email, redirectTo) { const c = await sb(); const { error } = await c.auth.resetPasswordForEmail(String(email).trim().toLowerCase(), { redirectTo }); if (error) fail(error, "Envoi du courriel impossible"); },
    async updatePassword(password) { const c = await sb(); const { error } = await c.auth.updateUser({ password }); if (error) fail(error, "Changement de mot de passe impossible"); },
    /** Profil de la personne connectée : { user_id, entreprise_id, role, nom, email, entreprises: { nom } } ou null. */
    async me() {
      if (me) return me;
      const c = await sb(); const { data: s } = await c.auth.getSession(); if (!s.session) return null;
      const { data, error } = await c.from("membres").select("user_id, entreprise_id, role, nom, email, entreprises(nom)").eq("user_id", s.session.user.id).maybeSingle();
      if (error) fail(error, "Profil introuvable"); me = data || null; return me;
    },

    // ───── espace de l'entreprise (document JSON = l'état complet de Lens) ─────
    async loadSpace(entrepriseId) { const c = await sb(); const { data, error } = await c.from("espaces").select("data, updated_at").eq("entreprise_id", entrepriseId).maybeSingle(); if (error) fail(error, "Lecture de l’espace impossible"); return data; },
    async saveSpace(entrepriseId, d) { const c = await sb(); const { error } = await c.from("espaces").upsert({ entreprise_id: entrepriseId, data: d }, { onConflict: "entreprise_id" }); if (error) fail(error, "Enregistrement en ligne impossible"); },

    // ───── vidéos d'enregistrement ─────
    async uploadRecording(entrepriseId, blob, name, meta) {
      const c = await sb(); const path = entrepriseId + "/" + name;
      const { error } = await c.storage.from("enregistrements").upload(path, blob, { contentType: blob.type || "video/webm", upsert: false });
      if (error) fail(error, "Envoi de la vidéo impossible");
      const base = { entreprise_id: entrepriseId, fichier: path, taille: blob.size, type: blob.type || "video/webm" };
      let { data, error: e2 } = await c.from("enregistrements").insert(Object.assign({}, base, meta || {})).select("id").single();
      if (e2 && /column|schema cache/i.test(e2.message || "")) {   // base pas encore à jour (colonne absente) : on garde les champs de base
        const min = Object.assign({}, base); ["processus", "departement", "qui", "duree_s"].forEach((k) => { if (meta && meta[k] != null) min[k] = meta[k]; });
        console.warn("Colonne absente dans enregistrements, fiche réduite :", e2.message);
        ({ data, error: e2 } = await c.from("enregistrements").insert(min).select("id").single());
      }
      if (e2) fail(e2, "Fiche de l’enregistrement impossible");
      return { id: data.id, path };
    },
    /** Images capturées pendant l'enregistrement : <entreprise>/images/<enregistrement>/f_001.jpg … */
    async uploadFrames(entrepriseId, recId, blobs, onProgress) {
      const c = await sb(); let n = 0;
      for (let i = 0; i < blobs.length; i++) {
        const path = entrepriseId + "/images/" + recId + "/f_" + String(i + 1).padStart(3, "0") + ".jpg";
        const { error } = await c.storage.from("enregistrements").upload(path, blobs[i], { contentType: "image/jpeg", upsert: true });
        if (!error) n++; if (onProgress) onProgress(i + 1, blobs.length);
      }
      await c.from("enregistrements").update({ images: n }).eq("id", recId);
      return n;
    },
    /** Lance la cartographie côté serveur (fonction « analyser »). */
    async analyse(recId) { const c = await sb(); const { data, error } = await c.functions.invoke("analyser", { body: { enregistrement_id: recId } }); if (error) { let msg = error.message || String(error); try { const ctx = error.context; if (ctx && ctx.json) { const j = await ctx.json(); if (j && j.error) msg = j.error; } } catch (_) {} fail({ message: msg }, "Analyse impossible"); } return data; },
    /** Entretien guidé après la cartographie : message null = ouverture. Renvoie { message, termine, epc_modifie }. */
    async questionnaire(processus, diagnostic, message) { const c = await sb(); const { data, error } = await c.functions.invoke("questionnaire", { body: { processus, diagnostic: diagnostic || null, message: message || null } }); if (error) { let msg = error.message || String(error); try { const ctx = error.context; if (ctx && ctx.json) { const j = await ctx.json(); if (j && j.error) msg = j.error; } } catch (_) {} fail({ message: msg }, "Questionnaire indisponible"); } return data; },
    async recording(recId) { const c = await sb(); const { data, error } = await c.from("enregistrements").select("id, statut, transcription, processus").eq("id", recId).maybeSingle(); if (error) fail(error, "Lecture de l’enregistrement impossible"); return data; },
    async listRecordings(entrepriseId) { const c = await sb(); const { data, error } = await c.from("enregistrements").select("id, processus, departement, qui, debut, duree_s, fichier, taille, statut, cree_le").eq("entreprise_id", entrepriseId).order("cree_le", { ascending: false }); if (error) fail(error, "Lecture des enregistrements impossible"); return data || []; },
    async recordingUrl(path, seconds) { const c = await sb(); const { data, error } = await c.storage.from("enregistrements").createSignedUrl(path, seconds || 3600); if (error) fail(error, "Lien de la vidéo impossible"); return data.signedUrl; },

    /** Création de compte (adresse invitée seulement). Renvoie { user, session } ; session null si la confirmation par courriel est exigée. */
    async signUp(email, password, nom) { const c = await sb(); const { data, error } = await c.auth.signUp({ email: String(email).trim().toLowerCase(), password, options: { data: { name: nom } } }); if (error) fail(error, "Création du compte impossible"); me = null; return data; },
    /** Crée l'entreprise d'une adresse invitée (ou renvoie celle déjà créée). Fonction SQL lens_creer_entreprise. */
    async createCompany(email, nom) { const c = await sb(); const { data, error } = await c.rpc("lens_creer_entreprise", { p_email: String(email).trim().toLowerCase(), p_nom: nom || "" }); if (error) fail(error, "Création de l’entreprise impossible"); return data; },
    /** Invitation d'une entreprise cliente par Groupe Lounici : l'adresse pourra créer son compte et son espace. */
    async invite(email, entrepriseNom, nom) { const c = await sb(); const { error } = await c.from("acces_autorises").upsert({ email: String(email).trim().toLowerCase(), role: "admin", entreprise_nom: entrepriseNom || null, nom: nom || null }, { onConflict: "email" }); if (error) fail(error, "Invitation impossible"); },
    async invitations() { const c = await sb(); const { data, error } = await c.from("acces_autorises").select("email, role, nom, entreprise_nom, entreprise_id, ajoute_le, entreprises(nom)").order("ajoute_le", { ascending: false }); if (error) fail(error, "Lecture des invitations impossible"); return data || []; },

    // ───── documents de contexte (PDF, Excel, Word, Markdown…) rattachés à un processus ─────
    async uploadDocument(entrepriseId, file, meta) {
      const c = await sb();
      const safe = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\-]+/g, "_");
      const path = entrepriseId + "/documents/" + Date.now().toString(36) + "-" + safe;
      const { error } = await c.storage.from("documents").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) fail(error, "Envoi du document impossible");
      const { data, error: e2 } = await c.from("documents").insert(Object.assign({ entreprise_id: entrepriseId, nom: file.name, fichier: path, taille: file.size, type: file.type || "" }, meta || {})).select("id").single();
      if (e2) fail(e2, "Fiche du document impossible");
      return { id: data.id, path };
    },
    async listDocuments(entrepriseId, processus) {
      const c = await sb(); let q = c.from("documents").select("id, nom, fichier, taille, type, processus, diagnostic, cree_le").eq("entreprise_id", entrepriseId).order("cree_le", { ascending: false });
      if (processus) q = q.eq("processus", processus);
      const { data, error } = await q; if (error) fail(error, "Lecture des documents impossible"); return data || [];
    },
    async documentUrl(path, seconds) { const c = await sb(); const { data, error } = await c.storage.from("documents").createSignedUrl(path, seconds || 3600); if (error) fail(error, "Lien du document impossible"); return data.signedUrl; },
    async deleteDocument(id, path) { const c = await sb(); await c.storage.from("documents").remove([path]); const { error } = await c.from("documents").delete().eq("id", id); if (error) fail(error, "Suppression impossible"); },

    // ───── gestion des accès (Groupe Lounici et administrateurs d'entreprise) ─────
    async allowEmail(email, entrepriseId, role, nom) { const c = await sb(); const { error } = await c.from("acces_autorises").upsert({ email: String(email).trim().toLowerCase(), entreprise_id: entrepriseId, role: role || "membre", nom: nom || null }, { onConflict: "email" }); if (error) fail(error, "Ajout à la liste des accès impossible"); },
    async signUpOther(email, password, nom) {
      lib = lib || await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      const c2 = lib.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await c2.auth.signUp({ email: String(email).trim().toLowerCase(), password, options: { data: { name: nom } } });
      if (error) fail(error, "Création du compte impossible"); return data.user;
    },
  };
})();
