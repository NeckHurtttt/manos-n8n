// Puente n8n: la página solo reconoce señas y mueve el avatar.
// Todo lo demás (armar la frase, voz, Telegram, guardar, resumen, emergencia) lo hace n8n.
//   Página ──POST /manos──▶ n8n ──▶ IA · Telegram · Supabase
//   Telegram ──▶ n8n (Whisper + IA) ──▶ Supabase.mensajes ──lee──▶ Página ──▶ avatar
import { N8N_URL, TELEGRAM_BOT, SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const activo = !!N8N_URL;
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const nuevoCodigo = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => LETRAS[b % LETRAS.length]).join('');

let sala = null;
try { sala = localStorage.getItem('mqh-sala'); } catch {}
if (!sala) { sala = nuevoCodigo(); try { localStorage.setItem('mqh-sala', sala); } catch {} }

export const codigo = () => sala;
export const linkTelegram = () => TELEGRAM_BOT ? `https://t.me/${TELEGRAM_BOT}?start=${sala}` : '';

async function n8n(accion, datos = {}, ms = 20000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${N8N_URL}/manos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion, sala, ...datos }), signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`n8n respondió ${r.status}`);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {};
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'n8n tardó demasiado' : e.message);
  } finally { clearTimeout(t); }
}

async function supa(ruta) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!r.ok) throw new Error('Supabase ' + r.status);
  return r.json();
}

export const abrirSala = () => n8n('sala');
export const armarFrase = (glosas, idioma) => n8n('frase', { glosas, idioma });
export const enviarFrase = (frase, glosas = []) => n8n('enviar', { frase, glosas });
export const emergencia = (lat, lon) => n8n('emergencia', { lat, lon });
export const resumen = () => n8n('resumen', {}, 40000);

export function nuevaSala() {
  sala = nuevoCodigo();
  try { localStorage.setItem('mqh-sala', sala); } catch {}
  ultimo = 0;
  return sala;
}

// Escucha lo que n8n deja en Supabase para esta sala.
let ultimo = 0, timer = null;
export function escuchar({ alMensaje, alVincular, alError }) {
  if (!activo || !SUPABASE_URL) return;
  let vinculada = null, fallos = 0;
  const vuelta = async () => {
    try {
      if (!vinculada) {
        const [s] = await supa(`salas?codigo=eq.${sala}&select=chat_id,nombre`);
        if (s?.chat_id) { vinculada = s; alVincular?.(s); }
      }
      if (!ultimo) {   // al entrar no repetir lo viejo
        const [u] = await supa(`mensajes?sala=eq.${sala}&select=id&order=id.desc&limit=1`);
        ultimo = u?.id || -1;
      }
      const ms = await supa(`mensajes?sala=eq.${sala}&id=gt.${ultimo}&dir=in.(vuelta,aviso)&select=id,dir,texto,glosas&order=id`);
      for (const m of ms) { ultimo = m.id; alMensaje?.(m); }
      fallos = 0;
    } catch (e) { if (++fallos === 3) alError?.(e); }
    timer = setTimeout(vuelta, 2000);
  };
  clearTimeout(timer); vuelta();
  return { reiniciar() { vinculada = null; clearTimeout(timer); vuelta(); } };
}
