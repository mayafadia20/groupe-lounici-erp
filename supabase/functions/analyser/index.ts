// Lens — fonction « analyser » : cartographie EPC d'un enregistrement d'écran par Claude, côté serveur.
//
// Appelée par Lens (lens-cloud.js → LensCloud.analyse) juste après l'envoi d'une vidéo et de ses images.
// 1. Vérifie que la personne connectée a accès à l'enregistrement (RLS, avec son jeton).
// 2. Passe l'enregistrement en statut « analyse » et répond tout de suite.
// 3. En tâche de fond : lit les images dans le bucket « enregistrements », les envoie à Claude avec le contexte
//    (processus, département, personne, documents du processus), écrit le diagramme dans l'espace de l'entreprise
//    (espaces.data.processes[].epc) et marque l'enregistrement « cartographie » (ou « erreur »).
//
// Secrets attendus (Edge Functions → Secrets) : ANTHROPIC_API_KEY. SUPABASE_URL, SUPABASE_ANON_KEY et
// SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement par Supabase.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const MODELE = "claude-opus-5-5";
const MAX_IMAGES = 30;
const BUCKET = "enregistrements";

const SYSTEME = `Tu es l'analyste de processus de Lens, l'outil de diagnostic de Groupe Lounici (Québec).
On te donne des images extraites, à intervalle régulier, d'une vidéo d'écran : une personne exécute une tâche réelle
dans ses logiciels (Excel, Outlook, navigateur, logiciel métier…). Chaque image porte son horodatage (mm:ss).
Ta tâche : reconstituer le processus sous forme de chaîne EPC (Event-driven Process Chain) avec les cinq types de nœuds
que Lens dessine : événement, étape, qui exécute, document (entrant ou sortant), système.

Règles :
- Identifie le logiciel ou le site visible sur chaque image (barre de titre, onglet, logo, adresse) ; c'est le « système » de l'étape.
- Regroupe les images en 2 à 10 étapes métier cohérentes, pas une étape par image. Une étape = un but (« Saisir les quantités »),
  pas un geste (« cliquer sur la cellule »).
- Les documents entrants sont ce que la personne consulte (fichier ouvert, courriel lu, page) ; les sortants ce qu'elle produit,
  envoie ou enregistre.
- Le déclencheur est l'événement qui lance la tâche ; chaque étape se termine par un événement qui mène à la suivante.
- Estime les durées à partir des horodatages. Les images identiques qui se suivent sont du temps d'attente ou de lecture.
- Dans evenements_source, cite les horodatages des images (ex. « 00:04 », « 00:12 »).
- Signale dans « constats » les frictions visibles : copier-coller entre logiciels, ressaisie, allers-retours entre fenêtres,
  recherche, attente. Si la vidéo est trop courte ou trop floue pour conclure, dis-le dans les constats plutôt que d'inventer.
- Ignore l'interface de Lens elle-même (la page d'enregistrement, ses boutons) : ce n'est pas une étape du processus du client,
  sauf si rien d'autre n'est visible.
- Rédige en français du Québec, de façon concise. Ne fabrique rien qui n'est pas visible.`;

const SCHEMA = {
  type: "object",
  properties: {
    processus: {
      type: "object",
      properties: {
        titre: { type: "string" }, departement: { type: "string" }, declencheur: { type: "string" },
        resultat: { type: "string" }, frequence_supposee: { type: "string" },
      },
      required: ["titre", "departement", "declencheur", "resultat", "frequence_supposee"], additionalProperties: false,
    },
    etapes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" }, titre: { type: "string" }, description: { type: "string" }, qui: { type: "string" }, systeme: { type: "string" },
          documents_entrants: { type: "array", items: { type: "string" } }, documents_sortants: { type: "array", items: { type: "string" } },
          duree_traitement_min: { type: "number" }, duree_attente_min: { type: "number" }, evenement_suivant: { type: "string" },
          evenements_source: { type: "array", items: { type: "string" } }, saisie_double: { type: "boolean" },
        },
        required: ["n", "titre", "description", "qui", "systeme", "documents_entrants", "documents_sortants", "duree_traitement_min",
          "duree_attente_min", "evenement_suivant", "evenements_source", "saisie_double"],
        additionalProperties: false,
      },
    },
    systemes: {
      type: "array",
      items: { type: "object", properties: { nom: { type: "string" }, genre: { type: "string", enum: ["bureau", "web", "inconnu"] }, usage: { type: "string" } },
        required: ["nom", "genre", "usage"], additionalProperties: false },
    },
    constats: {
      type: "array",
      items: { type: "object", properties: { titre: { type: "string" }, detail: { type: "string" }, evenements: { type: "array", items: { type: "string" } },
        gravite: { type: "string", enum: ["faible", "moyenne", "forte"] } }, required: ["titre", "detail", "evenements", "gravite"], additionalProperties: false },
    },
  },
  required: ["processus", "etapes", "systemes", "constats"], additionalProperties: false,
};

type Rec = { id: string; entreprise_id: string; processus: string | null; departement: string | null; qui: string | null; duree_s: number | null; fichier: string | null; images: number | null; diagnostic?: string | null; description?: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "Secret ANTHROPIC_API_KEY manquant dans la fonction." }, 500);
  let body: { enregistrement_id?: string } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  if (!body.enregistrement_id) return json({ error: "enregistrement_id requis" }, 400);

  // accès vérifié avec le jeton de la personne (RLS)
  const moi = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: rec, error } = await moi.from("enregistrements").select("id, entreprise_id, processus, departement, qui, duree_s, fichier, images, diagnostic, description").eq("id", body.enregistrement_id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!rec) return json({ error: "Enregistrement introuvable ou accès refusé." }, 404);

  const admin = createClient(url, service);
  await admin.from("enregistrements").update({ statut: "analyse" }).eq("id", rec.id);
  EdgeRuntime.waitUntil(analyser(admin, rec as Rec).catch(async (e) => {
    console.error(e);
    await admin.from("enregistrements").update({ statut: "erreur", transcription: `Erreur d'analyse : ${e?.message ?? e}` }).eq("id", rec.id);
  }));
  return json({ ok: true, statut: "analyse" });
});

async function analyser(admin: SupabaseClient, rec: Rec) {
  // 1. images de l'enregistrement
  const dossier = `${rec.entreprise_id}/images/${rec.id}`;
  const { data: fichiers, error } = await admin.storage.from(BUCKET).list(dossier, { limit: 500, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(`Lecture des images : ${error.message}`);
  const tous = (fichiers ?? []).filter((f) => /\.jpe?g$/i.test(f.name));
  if (!tous.length) throw new Error("Aucune image pour cet enregistrement (le navigateur n'en a pas envoyé).");
  const pas = Math.max(1, Math.ceil(tous.length / MAX_IMAGES));
  const choisis = tous.filter((_, i) => i % pas === 0).slice(0, MAX_IMAGES);
  const intervalle = rec.duree_s && tous.length ? rec.duree_s / tous.length : 2;

  const contenu: Anthropic.MessageParam["content"] = [];
  const duree = rec.duree_s ?? 0;
  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // 2. documents du processus (noms, et texte s'il a déjà été extrait)
  let docsTxt = "";
  const { data: docs } = await admin.from("documents").select("nom, texte").eq("entreprise_id", rec.entreprise_id).eq("processus", rec.processus ?? "").limit(10);
  if (docs?.length) {
    docsTxt = "\nDocuments joints au processus : " + docs.map((d) => d.nom).join(", ") + "\n" +
      docs.filter((d) => d.texte).map((d) => `--- ${d.nom} ---\n${String(d.texte).slice(0, 6000)}`).join("\n");
  }

  (contenu as Anthropic.ContentBlockParam[]).push({ type: "text", text:
    `Processus : ${rec.processus ?? "(non précisé)"}\nDépartement : ${rec.departement ?? "(non précisé)"}\nPersonne qui exécute : ${rec.qui ?? "(non précisée)"}\n` +
    (rec.diagnostic ? `${rec.diagnostic}${rec.description ? " : " + rec.description : ""}\n` : "") +
    `Durée de la vidéo : ${mmss(duree)} · ${tous.length} images capturées, ${choisis.length} transmises.${docsTxt}\n` });

  for (const f of choisis) {
    const idx = tous.indexOf(f);
    const { data: blob, error: e2 } = await admin.storage.from(BUCKET).download(`${dossier}/${f.name}`);
    if (e2 || !blob) continue;
    const b64 = base64(new Uint8Array(await blob.arrayBuffer()));
    (contenu as Anthropic.ContentBlockParam[]).push({ type: "text", text: `Image ${mmss(idx * intervalle)}` });
    (contenu as Anthropic.ContentBlockParam[]).push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  }
  (contenu as Anthropic.ContentBlockParam[]).push({ type: "text", text: "Produis la chaîne EPC complète au format JSON demandé." });

  // 3. Claude
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const reponse = await client.messages.create({
    model: MODELE, max_tokens: 16000, system: SYSTEME,
    messages: [{ role: "user", content: contenu }],
    // deno-lint-ignore no-explicit-any
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } } as any,
  });
  if (reponse.stop_reason === "refusal") throw new Error("Claude a refusé l'analyse de cet enregistrement.");
  const texte = reponse.content.find((b) => b.type === "text");
  if (!texte || texte.type !== "text") throw new Error("Réponse sans texte.");
  const epc = JSON.parse(texte.text);

  // 4. diagramme au format de lens.js
  const qui = (t: string) => { const m = /^(.*)\((.*)\)\s*$/.exec(t ?? ""); return m ? [m[1].trim(), m[2].trim()] : [(t ?? "").trim(), ""]; };
  const dureeTxt = (e: { duree_traitement_min: number; duree_attente_min: number }) => {
    if (e.duree_attente_min >= Math.max(e.duree_traitement_min * 2, 30)) return `attente ${Math.round(e.duree_attente_min)} min`;
    return e.duree_traitement_min >= 1 ? `${Math.round(e.duree_traitement_min)} min` : `${Math.max(1, Math.round(e.duree_traitement_min * 60))} s`;
  };
  const lensEpc = {
    trigger: epc.processus.declencheur, result: epc.processus.resultat,
    // deno-lint-ignore no-explicit-any
    steps: epc.etapes.map((e: any) => ({ title: e.titre, dur: dureeTxt(e), who: qui(e.qui)[0] || rec.qui || "", dept: qui(e.qui)[1], in: e.documents_entrants, out: e.documents_sortants,
      sys: e.systeme ? [e.systeme] : [], event: e.evenement_suivant, bottleneck: !!e.saisie_double, events: e.evenements_source })),
    // deno-lint-ignore no-explicit-any
    constats: epc.constats.map((c: any) => ({ titre: c.titre, detail: c.detail, gravite: c.gravite, evenements: c.evenements })),
    systemes: epc.systemes,
    source: { type: "video", images: choisis.length, qui: rec.qui, duree_s: duree, clicks: null, enregistrement_id: rec.id, date: new Date().toISOString(), diagnostic: rec.diagnostic ?? null, description: rec.description ?? null },
  };

  // 5. écriture dans l'espace de l'entreprise
  const { data: esp, error: e3 } = await admin.from("espaces").select("data").eq("entreprise_id", rec.entreprise_id).maybeSingle();
  if (e3) throw new Error(`Lecture de l'espace : ${e3.message}`);
  // deno-lint-ignore no-explicit-any
  const data: any = esp?.data ?? {};
  data.processes = Array.isArray(data.processes) ? data.processes : [];
  // deno-lint-ignore no-explicit-any
  let p = data.processes.find((x: any) => String(x.title).toLowerCase() === String(rec.processus ?? "").toLowerCase());
  if (!p) { p = { dept: (rec.departement ?? "").toUpperCase(), ver: "v1", title: rec.processus ?? epc.processus.titre, steps: 0, recs: 1, epc: null }; data.processes.unshift(p); }
  // chaque diagnostic (enregistrement) garde son propre diagramme ; l'analyse comparera les diagnostics plus tard
  p.diagnostics = Array.isArray(p.diagnostics) ? p.diagnostics : [];
  // deno-lint-ignore no-explicit-any
  let d = rec.diagnostic ? p.diagnostics.find((x: any) => x.name === rec.diagnostic) : null;
  if (!d) d = p.diagnostics[p.diagnostics.length - 1];
  if (!d) { d = { name: rec.diagnostic ?? "Diagnostic 1", desc: rec.description ?? "", date: new Date().toISOString(), duree_s: rec.duree_s }; p.diagnostics.push(d); }
  d.epc = lensEpc; if (rec.description && !d.desc) d.desc = rec.description;
  p.epc = null; p.steps = lensEpc.steps.length;
  const { error: e4 } = await admin.from("espaces").upsert({ entreprise_id: rec.entreprise_id, data }, { onConflict: "entreprise_id" });
  if (e4) throw new Error(`Écriture de l'espace : ${e4.message}`);

  await admin.from("enregistrements").update({
    statut: "cartographie", epc,
    transcription: `Analyse par ${reponse.model} · ${choisis.length} images · ${reponse.usage.input_tokens} jetons en entrée, ${reponse.usage.output_tokens} en sortie`,
  }).eq("id", rec.id);
}

function base64(bytes: Uint8Array): string {
  let s = ""; const bloc = 0x8000;
  for (let i = 0; i < bytes.length; i += bloc) s += String.fromCharCode(...bytes.subarray(i, i + bloc));
  return btoa(s);
}
