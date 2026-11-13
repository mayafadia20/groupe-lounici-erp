// Connexion de Lens à sa base en ligne (Supabase, projet « Lens Diagnostic », Canada Central).
// Laisser url et anonKey vides = mode local : données dans ce navigateur seulement, portail client à identifiant unique.
// La clé « anon » est publique par conception ; la sécurité repose sur les comptes et les règles RLS
// de supabase/schema.sql. Ne jamais mettre ici la clé « service_role ».
window.LENS_CONFIG = {
  url: "https://afcwntgvmpkulngcueaq.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmY3dudGd2bXBrdWxuZ2N1ZWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1OTI1MDYsImV4cCI6MjEwODE2ODUwNn0.40h5INpFDoFkUNB7x08b36N0QhA6JSUhCbbAfm1vun4",
};
