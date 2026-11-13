// Lens — fonction « questionnaire » : entretien guidé par Claude après la cartographie d'un diagnostic.
//
// Lens envoie { processus, diagnostic, message } (message vide à l'ouverture). La fonction retrouve l'entreprise
// de la personne connectée, charge le diagramme EPC du diagnostic et l'historique de la conversation, demande à
// Claude la prochaine intervention (question pertinente, ou prise en compte d'une correction), met à jour le
// diagramme si la personne a signalé une erreur, enregistre la conversation dans l'espace et renvoie la réponse.
//
// Secrets : ANTHROPIC_API_KEY (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY sont fournis).

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const MODELE = "claude-opus-5-5";

const SYSTEME = `Tu es l'analyste de processus de Lens (Groupe Lounici, Québec). Un diagramme EPC vient d'être produit
automatiquement à partir d'un enregistrement d'écran. Tu mènes un court entretien avec la personne qui a exécuté la tâche,
pour valider et enrichir ce diagramme.

Tu reçois le diagramme (déclencheur, étapes avec qui exécute, documents entrants et sortants, systèmes, durées, résultat,
constats) et l'historique de la conversation. À chaque tour, tu renvoies un JSON :
- "message" : ce que tu dis à la personne. Une seule question à la fois, précise, utile, en français du Québec, ton direct
  et chaleureux. Commence par une phrase qui montre ce que tu as compris du processus, puis la première question.
- "epc" : le diagramme complet corrigé, si la personne vient de signaler une erreur ou d'apporter une précision qui change
  le diagramme (étape manquante, mal nommée ou à supprimer, document oublié, système, durée, qui exécute, déclencheur,
  résultat). Sinon null. Quand tu modifies, garde la même structure et conserve tout ce qui n'est pas concerné.
- "termine" : true quand tu as fait le tour (au plus 6 questions) ou que la personne dit qu'elle a terminé.

Questions prioritaires : les durées réelles et les attentes entre étapes, la fréquence de la tâche, ce qui n'était pas
visible à l'écran (appels, papier, déplacements), les documents consultés ou produits, les étapes qui varient d'un cas
à l'autre, les irritants. Ne pose jamais une question dont la réponse est déjà dans le diagramme ou la conversation.
Si la personne corrige quelque chose, applique la correction, confirme en une phrase ce que tu as changé, puis enchaîne.`;

const SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string" },
    termine: { type: "boolean" },
    epc: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            trigger: { type: "string" }, result: { type: "string" },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" }, dur: { type: "string" }, who: { type: "string" }, dept: { type: "string" },
                  in: { type: "array", items: { type: "string" } }, out: { type: "array", items: { type: "string" } }, sys: { type: "array", items: { type: "string" } },
                  event: { type: "string" }, bottleneck: { type: "boolean" },
                },
                required: ["title", "dur", "who", "dept", "in", "out", "sys", "event", "bottleneck"], additionalProperties: false,
              },
            },
            constats: {
              type: "array",
              items: { type: "object", properties: { titre: { type: "string" }, detail: { type: "string" }, gravite: { type: "string", enum: ["faible", "moyenne", "forte"] } },
                required: ["titre", "detail", "gravite"], additionalProperties: false },
            },
          },
          required: ["trigger", "result", "steps", "constats"], additionalProperties: false,
        },
      ],
    },
  },
  required: ["message", "termine", "epc"], additionalProperties: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "Secret ANTHROPIC_API_KEY manquant." }, 500);
  let body: { processus?: string; diagnostic?: string; message?: string | null } = {};
  try { body = await req.json(); } catch { /* vide */ }
  if (!body.processus) return json({ error: "processus requis" }, 400);

  const moi = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: membre, error: e0 } = await moi.from("membres").select("entreprise_id, nom").limit(1).maybeSingle();
  if (e0 || !membre?.entreprise_id) return json({ error: "Accès refusé." }, 403);

  const admin = createClient(url, service);
  const { data: esp, error: e1 } = await admin.from("espaces").select("data").eq("entreprise_id", membre.entreprise_id).maybeSingle();
  if (e1 || !esp) return json({ error: "Espace introuvable." }, 404);
  // deno-lint-ignore no-explicit-any
  const data: any = esp.data ?? {};
  // deno-lint-ignore no-explicit-any
  const p = (data.processes ?? []).find((x: any) => String(x.title).toLowerCase() === String(body.processus).toLowerCase());
  if (!p) return json({ error: "Processus introuvable." }, 404);
  p.diagnostics = Array.isArray(p.diagnostics) ? p.diagnostics : [];
  // deno-lint-ignore no-explicit-any
  const d = body.diagnostic ? p.diagnostics.find((x: any) => x.name === body.diagnostic) : p.diagnostics.filter((x: any) => x.epc).pop();
  if (!d || !d.epc) return json({ error: "Ce diagnostic n'a pas encore de diagramme." }, 409);

  // historique
  d.chat = Array.isArray(d.chat) ? d.chat : [];
  const texte = (body.message ?? "").trim();
  if (texte) d.chat.push({ role: "user", content: texte, ts: new Date().toISOString() });

  const contexte = `Processus : ${p.title} (${p.dept ?? ""})\n${d.name}${d.desc ? " : " + d.desc : ""}\nPersonne : ${membre.nom ?? ""}\n\nDiagramme actuel (JSON) :\n${JSON.stringify({ trigger: d.epc.trigger, result: d.epc.result, steps: d.epc.steps, constats: d.epc.constats ?? [] })}`;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: contexte + "\n\n" + (d.chat.length ? "Historique de la conversation :" : "Aucune conversation encore : ouvre l'entretien.") }];
  // deno-lint-ignore no-explicit-any
  for (const m of d.chat as any[]) messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  if (messages.length > 1 && messages[messages.length - 1].role === "assistant") messages.push({ role: "user", content: "(Continue l'entretien.)" });
  // les tours doivent alterner : on fusionne les messages consécutifs de même rôle
  const fusion: Anthropic.MessageParam[] = [];
  for (const m of messages) { const prev = fusion[fusion.length - 1]; if (prev && prev.role === m.role) prev.content = String(prev.content) + "\n\n" + String(m.content); else fusion.push({ role: m.role, content: String(m.content) }); }

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const reponse = await client.messages.create({
    model: MODELE, max_tokens: 8000, system: SYSTEME, messages: fusion,
    // deno-lint-ignore no-explicit-any
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } } as any,
  });
  if (reponse.stop_reason === "refusal") return json({ error: "Claude a décliné cette demande." }, 502);
  const bloc = reponse.content.find((b) => b.type === "text");
  if (!bloc || bloc.type !== "text") return json({ error: "Réponse vide." }, 502);
  const out = JSON.parse(bloc.text) as { message: string; termine: boolean; epc: null | Record<string, unknown> };

  let epcModifie = false;
  if (out.epc && Array.isArray((out.epc as { steps?: unknown[] }).steps)) {
    const ancien = d.epc; d.epc = { ...ancien, ...out.epc, source: { ...(ancien.source ?? {}), corrige_le: new Date().toISOString(), corrige_par: "questionnaire" } };
    p.steps = (d.epc.steps as unknown[]).length; epcModifie = true;
  }
  d.chat.push({ role: "assistant", content: out.message, ts: new Date().toISOString(), epc_modifie: epcModifie });
  if (out.termine) d.chat_termine = true;
  const { error: e2 } = await admin.from("espaces").upsert({ entreprise_id: membre.entreprise_id, data }, { onConflict: "entreprise_id" });
  if (e2) return json({ error: "Écriture de l'espace : " + e2.message }, 500);
  return json({ message: out.message, termine: !!out.termine, epc_modifie: epcModifie });
});
