// ============================================================
// CONFIGURACIÓN — Panel Cooperativa Cimientos
// ============================================================

// Pegá acá los datos de tu proyecto Supabase
// (Supabase > Project Settings > API). Mientras estos dos valores
// sigan con el texto "PONE_ACA_...", el panel funciona 100% local
// (localStorage de este navegador, como hasta ahora) — así podés
// seguir probando sin depender de Supabase, y cuando los completes
// el panel pasa solo a usar la base de datos real, sin tocar código.
const SUPABASE_URL = "https://htabclnucpmpfjesxqdt.supabase.co";
// Clave publicable: puede estar en el navegador; RLS protege los datos.
const SUPABASE_ANON_KEY = "sb_publishable_spBwzgttLEBALoI1YFm6hA_Y8vQTKjw";

// Mientras esto está en false, el panel abre directo, sin pantalla
// de login (ideal para probar el panel vos solo). Cuando esté listo
// para que el Consejo lo use de verdad, cambialo a true, corré el
// bloque "ENDURECER RLS PARA PRODUCCIÓN" del supabase-schema.sql,
// y creá los usuarios en Supabase > Authentication > Users.
const LOGIN_REQUIRED = true;

// Los socios fundadores (constitución) ya tienen número asignado
// por fuera de este sistema. Poné acá el PRÓXIMO número libre
// (cantidad de fundadores + 1) para que el panel nunca sugiera un
// número que ya está en uso — es solo una sugerencia editable.
const PROXIMO_NUMERO_SOCIO_SUGERIDO = 38; // ⚠️ confirmar cantidad exacta de fundadores y ajustar
