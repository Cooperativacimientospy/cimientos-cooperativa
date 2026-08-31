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

// El login ya está activo: el panel pide correo y contraseña de
// Supabase Authentication antes de mostrar cualquier dato. Para
// sumar a alguien del Consejo, creale su usuario en Supabase >
// Authentication > Users — no hay alta de funcionarios desde el panel.
const LOGIN_REQUIRED = true;

// Ya no se usa: el próximo número de socio lo calcula y asigna el
// servidor de forma transaccional (ver supabase-migracion-p0.sql,
// tabla configuracion_institucional) para que dos administradores
// nunca puedan terminar con el mismo número. Se deja esta constante
// solo para no romper una carga muy vieja del panel sin Supabase.
const PROXIMO_NUMERO_SOCIO_SUGERIDO = 38;

// Dirección web real donde vive el panel (la que usan para entrar desde
// el navegador, sin barra al final: https://tu-dominio.com). El panel la
// usa como respaldo para armar el link del formulario que se manda por
// WhatsApp en Pre-registro, SOLO para el caso en que alguien abra
// panel.html como archivo local en vez de entrar por la web (ahí el
// navegador no sabe cuál es "el sitio" y el link sale roto, tipo
// "file:///formulario"). Si siempre entrás por la web real, podés dejar
// esto vacío — no hace falta.
const SITE_URL = "https://cooperativacimientospy.github.io/cimientos-cooperativa";
