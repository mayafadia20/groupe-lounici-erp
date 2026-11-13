// Groupe Lounici — interactions légères (aucune dépendance)

(function () {
  // ── Langue : français par défaut, anglais au clic sur « EN ». Le choix est mémorisé (localStorage)
  //    et suivi sur toutes les pages. Le français vit dans le HTML ; l'anglais dans ce dictionnaire.
  //    data-i18n="cle" traduit le contenu ; data-i18n-attr="attr=cle;attr2=cle2" traduit des attributs.
  const EN = {
      "title_home": "Home | Groupe Lounici",
      "meta_desc": "Groupe Lounici is a problem-solving and continuous-improvement firm: mergers and acquisitions, strategy, system implementation, structural change. Results within the first 30 days.",
      "brand_home": "Groupe Lounici — home",
      "nav_label": "Main navigation",
      "nav_expertise": "Our expertise",
      "nav_about": "About us",
      "nav_contact": "Contact us",
      "nav_portal": "Client portal",
      "nav_toggle": "Open menu",
      "lang_label": "Language",
      "mega_title": "Our expertise <span aria-hidden=\"true\">→</span>",
      "exp_1": "Corporate strategy",
      "exp_2": "Corporate finance",
      "exp_3": "Operational excellence",
      "exp_4": "Supply chain",
      "exp_5": "Organization and governance",
      "exp_6": "Systems engineering",
      "exp_7": "Data and analytics",
      "exp_8": "Artificial intelligence",
      "exp_9": "Public procurement",
      "exp_10": "Performance management",
      "hero_title": "<span class=\"dim\">Turning vision</span><br>into measurable results.",
      "hero_cta": "Request a consultation",
      "card_tag": "Our tools",
      "card_sub": "Operational diagnosis",
      "hero_lead": "We have our own technology arsenal to measure your performance, align it with your vision and build the action plan that will take your company where you want it to go.",
        "statement": "\n          We believe the best decisions come from combining human expertise, data and technology.\n          <span class=\"dim\">Our technology ecosystem speeds up diagnosis, structures execution and gives leaders continuous visibility on their performance, turning strategy into measurable results.</span>\n        ",
      "expo_pill": "Our expertise",
      "expo_title": "Areas of expertise",
      "caro_role": "carousel",
      "slide_role": "slide",
      "card_1": "Choose a direction, put numbers on it and make it hold across the organization, not just in a document.",
      "card_2": "Mergers, acquisitions, financing: value has to survive the transaction, then the integration.",
      "card_3": "Costs, lead times, quality, capacity: fixed on the floor with your teams, who then carry on without us.",
      "card_4": "Inventory, suppliers, logistics: a readable flow from order to delivery.",
      "card_5": "Roles, responsibilities, governance bodies: a structure that decides fast and holds.",
      "card_6": "ERP, CRM, business tools: delivered, adopted and profitable.",
      "card_7": "Reliable indicators, read every week, that trigger decisions.",
      "card_8": "Use cases chosen for their return, deployed with your data and your teams.",
      "card_9": "SEAO monitoring, tender qualification and bids that win.",
      "card_10": "A dashboard, targets and a review cadence that last over time.",
      "more": "Learn more",
      "prev": "Previous expertise",
      "next": "Next expertise",
      "dots": "Choose an expertise",
      "cta": "Discuss a mandate",
      "about_title": "<span class=\"dim\">From vision to strategy.</span><br>From strategy to results.",
      "about_p1": "I turn ambitious business visions into clear, actionable strategies designed to deliver measurable results.",
      "about_p2": "By understanding each organization’s goals, operations and challenges, I identify the most effective path forward, aligning people, processes and technology to accelerate growth.",
      "about_p3": "My approach bridges strategic vision and operational execution, ensuring that every decision, initiative and resource contributes to a greater objective.",
      "contact_title": "Let’s discuss your priorities.<br>Let’s plan a first conversation.",
      "f_name": "Name",
      "f_email": "Email",
      "f_company": "Company",
      "f_problem": "Your need or project, in a few words",
      "f_send": "Send",
      "foot_top": "Back to top ↑",
      "close": "Close",
      "modal_title": "Welcome, log in to<br>your account.",
      "m_user": "Username or email address",
      "m_user_ph": "name@domain.com",
      "m_pass": "Password",
      "m_pass_ph": "Your password",
      "m_submit": "Sign in",
      "m_lost": "Lost your password?",
      "m_msg_empty": "Please enter your username and password.",
      "m_msg_bad": "Incorrect username or password.",
      "title_tools": "Tools | Groupe Lounici",
      "title_erp": "Log in | Groupe Lounici",
      "brand_portal": "Groupe Lounici — client portal",
      "p_tools": "Tools",
      "p_logout": "Log out",
      "p_title": "Your tools,<br>in one place",
      "p_lead": "Groupe Lounici’s technology arsenal to measure your performance, align it with your vision and track your action plan.",
      "slide_1": "1 of 10",
      "slide_2": "2 of 10",
      "slide_3": "3 of 10",
      "slide_4": "4 of 10",
      "slide_5": "5 of 10",
      "slide_6": "6 of 10",
      "slide_7": "7 of 10",
      "slide_8": "8 of 10",
      "slide_9": "9 of 10",
      "slide_10": "10 of 10"
  };
  const LANG_KEY = "langue";
  const frContent = new WeakMap(), frAttrs = new WeakMap();
  function getLang() { try { return localStorage.getItem(LANG_KEY) === "en" ? "en" : "fr"; } catch (_) { return "fr"; } }
  function t(key, fr) { return getLang() === "en" && EN[key] !== undefined ? EN[key] : fr; }
  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (el.closest(".is-clone")) return;
      if (!frContent.has(el)) frContent.set(el, el.innerHTML);
      const en = EN[el.dataset.i18n];
      el.innerHTML = lang === "en" && en !== undefined ? en : frContent.get(el);
    });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      if (el.closest(".is-clone")) return;
      if (!frAttrs.has(el)) frAttrs.set(el, {});
      const mem = frAttrs.get(el);
      el.dataset.i18nAttr.split(";").forEach((pair) => {
        const [attr, key] = pair.split("=");
        if (!(attr in mem)) mem[attr] = el.getAttribute(attr);
        const en = EN[key];
        el.setAttribute(attr, lang === "en" && en !== undefined ? en : mem[attr]);
      });
    });
    document.querySelectorAll(".lang a").forEach((a) => {
      const on = a.getAttribute("lang") === lang;
      a.classList.toggle("is-on", on);
      if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
  }
  document.querySelectorAll(".lang a").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const lang = a.getAttribute("lang") === "en" ? "en" : "fr";
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
      applyLang(lang);
    });
  });
  applyLang(getLang());

  // Année du pied de page
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Menu mobile
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  // Grand menu « Our expertise » : ouvert au clic, fermé par un second clic,
  // un clic ailleurs, la touche Échap ou le choix d'un lien
  const megaBtn = document.querySelector(".has-menu");
  const mega = megaBtn && document.getElementById(megaBtn.getAttribute("aria-controls"));
  if (megaBtn && mega) {
    const setMega = (open) => {
      mega.hidden = !open;
      megaBtn.setAttribute("aria-expanded", String(open));
    };
    megaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMega(mega.hidden);
    });
    mega.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest("a")) setMega(false);
    });
    document.addEventListener("click", () => setMega(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMega(false); });
  }

  // Portail client : la fenêtre de connexion s'ouvre au clic sur « Client Portal »
  // et se ferme par la croix, un clic sur le fond assombri ou la touche Échap
  // tous les liens vers #portail ouvrent la fenêtre de connexion (menu et carte outil du héros)
  const portalLinks = document.querySelectorAll('a[href="#portail"]');
  const modal = document.getElementById("portail");
  const pageConnexion = document.body.classList.contains("erp-login");
  if (pageConnexion && modal && typeof modal.showModal === "function") {
    // ERP (erp.lounici.ca) : la fenêtre de connexion est la page elle-même, ouverte d'office et impossible à fermer ;
    // une session déjà ouverte mène directement au portail
    let dejaConnecte = false;
    try { dejaConnecte = (window.LensCloud && LensCloud.enabled) ? LensCloud.hasLocalSession() : sessionStorage.getItem("portail") === "1"; } catch (_) {}
    if (dejaConnecte) { try { sessionStorage.setItem("portail", "1"); } catch (_) {} window.location.replace("portail.html"); return; }
    modal.showModal();
    modal.addEventListener("cancel", (e) => e.preventDefault());
  }
  if ((portalLinks.length || pageConnexion) && modal && typeof modal.showModal === "function") {
    portalLinks.forEach((portalLink) => portalLink.addEventListener("click", (e) => {
      e.preventDefault();
      modal.querySelector(".login-form").reset();
      modal.querySelector(".login-msg").hidden = true;
      modal.showModal();
    }));
    const fermer = modal.querySelector(".modal-close");
    if (fermer) fermer.addEventListener("click", () => modal.close());
    if (!pageConnexion) modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });
    // Pas de serveur derrière le formulaire : la vérification se fait dans le navigateur,
    // en comparant l'empreinte SHA-256 de « courriel:mot de passe » à celle attendue.
    // Le mot de passe n'apparaît pas en clair ici, mais ce n'est pas une vraie protection.
    const EMPREINTE = "662106a346a21f1d9d48fb777b0976a1970b79b6ea7f2b4e9139b79bfa8a4b47";
    const form = modal.querySelector(".login-form");
    const msg = form.querySelector(".login-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const courriel = form.querySelector("[name=identifiant]").value.trim().toLowerCase();
      const mdp = form.querySelector("[name=mot-de-passe]").value;
      if (!courriel || !mdp) { msg.textContent = t("m_msg_empty", "Veuillez saisir votre identifiant et votre mot de passe."); msg.hidden = false; return; }
      if (window.LensCloud && LensCloud.enabled) {
        // Base en ligne : comptes Supabase (courriel + mot de passe), réservés aux adresses autorisées
        const btn = form.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
        try { await LensCloud.signIn(courriel, mdp); }
        catch (err) { msg.textContent = t("m_msg_bad", "Identifiant ou mot de passe incorrect."); msg.hidden = false; if (btn) btn.disabled = false; return; }
        if (btn) btn.disabled = false;
        try { sessionStorage.setItem("portail", "1"); } catch (_) {}
        window.location.href = "portail.html"; return;
      }
      if ((await sha256(courriel + ":" + mdp)) !== EMPREINTE) {
        msg.textContent = t("m_msg_bad", "Identifiant ou mot de passe incorrect.");
        msg.hidden = false;
        return;
      }
      try { sessionStorage.setItem("portail", "1"); } catch (_) {}
      window.location.href = "portail.html";
    });
    modal.addEventListener("close", () => { form.reset(); form.querySelector(".login-msg").hidden = true; });
  }

  // Page du portail : accessible seulement après le formulaire de connexion ;
  // « Log out » efface la session et ramène à l'accueil
  if (document.body.classList.contains("portail")) {
    let ouvert = false;
    try { ouvert = sessionStorage.getItem("portail") === "1"; } catch (_) {}
    if (!ouvert && window.LensCloud && LensCloud.hasLocalSession()) { ouvert = true; try { sessionStorage.setItem("portail", "1"); } catch (_) {} }
    if (!ouvert) { window.location.replace("index.html"); return; }
    // outils réservés à Groupe Lounici (ex. CRM) : retirés pour les comptes clients
    if (window.LensCloud && LensCloud.enabled) LensCloud.me().then((m) => { if (!m || m.role !== "lounici") document.querySelectorAll('[data-role="lounici"]').forEach((el) => el.remove()); }).catch(() => {});
    const sortie = document.getElementById("deconnexion");
    if (sortie) sortie.addEventListener("click", () => { try { sessionStorage.removeItem("portail"); } catch (_) {} if (window.LensCloud && LensCloud.enabled) LensCloud.signOut(); });
  }

  // Apparition au défilement et compteurs
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targets = document.querySelectorAll(".reveal");

  const animateCount = (el) => {
    if (el.dataset.done) return;
    el.dataset.done = "1";
    const target = Number(el.dataset.count || 0);
    const suffix = el.dataset.suffix || "";
    if (reduced) { el.textContent = target + suffix; return; }
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const show = (el) => {
    el.classList.add("is-visible");
    el.querySelectorAll(".count").forEach(animateCount);
  };

  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -5% 0px" }
    );
    targets.forEach((t) => io.observe(t));
  } else {
    targets.forEach(show);
  }

  // Empreinte SHA-256 en hexadécimal : fonction native du navigateur quand elle
  // existe (https), sinon une implémentation en JavaScript pur
  async function sha256(texte) {
    const octets = new TextEncoder().encode(texte);
    if (window.crypto && crypto.subtle) {
      const h = await crypto.subtle.digest("SHA-256", octets);
      return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    return sha256js(octets);
  }
  function sha256js(octets) {
    const K = [];
    for (let i = 0, n = 2; K.length < 64; n++) {
      if ([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113,
           127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251,
           257, 263, 269, 271, 277, 281, 283, 293, 307, 311][i] === n) { K.push(Math.floor(Math.cbrt(n) % 1 * 2 ** 32) >>> 0); i++; }
    }
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = octets.length, bits = l * 8, total = Math.ceil((l + 9) / 64) * 64;
    const m = new Uint8Array(total); m.set(octets); m[l] = 0x80;
    new DataView(m.buffer).setUint32(total - 4, bits >>> 0); new DataView(m.buffer).setUint32(total - 8, Math.floor(bits / 2 ** 32));
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const W = new Uint32Array(64);
    for (let o = 0; o < total; o += 64) {
      const v = new DataView(m.buffer, o, 64);
      for (let t = 0; t < 16; t++) W[t] = v.getUint32(t * 4);
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = H.map((x, i) => (x + [a, b, c, d, e, f, g, h][i]) >>> 0);
    }
    return H.map((x) => x.toString(16).padStart(8, "0")).join("");
  }

  // Carrousel des expertises : carte active au centre, voisines en retrait derrière ; boucle infinie
  // (un clone de la dernière carte en tête, un clone de la première en queue) ; défile seul toutes les 5 s
  const caro = document.querySelector(".caro");
  if (caro) {
    const track = caro.querySelector(".caro-track");
    const cards = Array.from(track.children);
    const N = cards.length;
    const dotsBox = document.querySelector(".caro-dots");
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

    const cloneLast = cards[N - 1].cloneNode(true);
    const cloneFirst = cards[0].cloneNode(true);
    [cloneLast, cloneFirst].forEach((cl) => { cl.classList.add("is-clone"); cl.setAttribute("aria-hidden", "true"); cl.removeAttribute("data-slide"); });
    track.insertBefore(cloneLast, cards[0]);
    track.appendChild(cloneFirst);
    const slots = Array.from(track.children);   // positions 0..N+1 ; la carte réelle k est à la position k+1
    // les clones suivent la langue de leur carte d'origine
    document.addEventListener("langchange", () => { cloneLast.innerHTML = cards[N - 1].innerHTML; cloneFirst.innerHTML = cards[0].innerHTML; });

    let index = 0, pos = 1, timer = null, snapTo = null;

    const dots = cards.map((_, k) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "caro-dot"; b.setAttribute("role", "tab");
      b.setAttribute("aria-label", "Expertise " + (k + 1));
      b.addEventListener("click", () => { go(k); restart(); });
      dotsBox.appendChild(b);
      return b;
    });

    function place() {
      const w = slots[0].offsetWidth;
      const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
      track.style.transform = "translateX(" + ((caro.clientWidth - w) / 2 - pos * (w + gap)) + "px)";
    }
    function mark() {
      slots.forEach((s, p) => s.classList.toggle("is-active", p === pos));
      cards.forEach((c, n) => c.setAttribute("aria-hidden", n === index ? "false" : "true"));
      dots.forEach((d, n) => { d.classList.toggle("is-on", n === index); d.setAttribute("aria-selected", n === index ? "true" : "false"); });
    }
    function snap(p) {   // repositionne sans animation (après être arrivé sur un clone)
      track.style.transition = "none";
      pos = p; mark(); place();
      void track.offsetWidth;
      track.style.transition = "";
    }
    // k peut valoir -1 (vers le clone de tête) ou N (vers le clone de queue) pour une boucle fluide
    function go(k) {
      snapTo = null;
      if (k < 0) { index = N - 1; pos = 0; snapTo = N; }
      else if (k >= N) { index = 0; pos = N + 1; snapTo = 1; }
      else { index = k; pos = k + 1; }
      mark(); place();
    }
    track.addEventListener("transitionend", (e) => { if (e.target === track && snapTo !== null) { const p = snapTo; snapTo = null; snap(p); } });

    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function restart() { stop(); if (motionOk) timer = setInterval(() => go(index + 1), 5000); }

    caro.querySelector(".caro-prev").addEventListener("click", () => { go(index - 1); restart(); });
    caro.querySelector(".caro-next").addEventListener("click", () => { go(index + 1); restart(); });
    slots.forEach((s, p) => s.addEventListener("click", (e) => {
      if (p === pos) return;
      e.preventDefault();
      go(p === 0 ? -1 : p === N + 1 ? N : p - 1); restart();
    }));
    caro.addEventListener("mouseenter", stop);
    caro.addEventListener("mouseleave", restart);
    caro.addEventListener("focusin", stop);
    caro.addEventListener("focusout", restart);
    caro.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { go(index + 1); restart(); }
      if (e.key === "ArrowLeft") { go(index - 1); restart(); }
    });

    // balayage tactile / souris
    let startX = null;
    caro.addEventListener("pointerdown", (e) => { startX = e.clientX; });
    caro.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX; startX = null;
      if (Math.abs(dx) > 40) { go(index + (dx < 0 ? 1 : -1)); restart(); }
    });

    // les liens du grand menu ouvrent directement la carte visée
    document.querySelectorAll('a[href="#expertises"][data-slide]').forEach((a) => {
      a.addEventListener("click", () => { go(Number(a.dataset.slide)); restart(); });
    });

    // la position dépend des largeurs réelles : recalcul au redimensionnement et une fois les polices chargées
    window.addEventListener("resize", place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : restart()));

    snap(1); restart();
  }
})();
