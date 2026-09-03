import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const requester = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await requester.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sesión inválida" }, 401);
    const { data: profile } = await requester.from("perfiles_admin").select("rol,activo").eq("id", userData.user.id).single();
    if (!profile || profile.activo === false) return json({ error: "Tu usuario no tiene acceso activo" }, 403);

    const body = await req.json();
    const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
    if (body.action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const nombre = String(body.nombre || "").trim();
      const cargo = String(body.cargo || "").trim();
      const telefono = String(body.telefono || "").trim();
      if (!email || !nombre || !cargo) return json({ error: "Revisá los datos de la invitación" }, 400);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { nombre, cargo }, redirectTo: String(body.redirectTo || ""),
      });
      if (error) return json({ error: error.message }, 400);
      if (!data.user) return json({ error: "No se pudo crear el usuario" }, 500);
      const saved = await admin.from("perfiles_admin").upsert({
        id: data.user.id, correo: email, nombre, cargo, telefono, rol: "superadministrador", activo: true,
      });
      if (saved.error) return json({ error: saved.error.message }, 400);
      return json({ ok: true, userId: data.user.id });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Error inesperado" }, 500);
  }
});
