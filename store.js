// Dónde se guardan señas, muestras, videos y modelo.
// - «nube»: Supabase (si config.js tiene URL y clave). Todos los que abren el link comparten los datos.
// - «local»: IndexedDB del navegador (si no hay Supabase configurado).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// ---------- Codificación compacta de Float32Array ----------
export function f32ToB64(a) {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF32(b) {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Float32Array(u.buffer);
}
const ARR = ['mean', 'std', 'W1', 'b1', 'W2', 'b2'];
export const encodeModel = m => { const o = { ...m }; for (const k of ARR) o[k] = f32ToB64(m[k]); return o; };
export const decodeModel = o => { if (!o) return null; const m = { ...o }; for (const k of ARR) m[k] = b64ToF32(o[k]); return m; };
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataToBlob = async d => (await fetch(d)).blob();

// ---------- Local (IndexedDB) ----------
async function abrirIDB() {
  return new Promise(res => {
    try {
      const r = indexedDB.open('manos-que-hablan', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function storeLocal(defaultVocab) {
  const DB = await abrirIDB(), mem = new Map();
  const tx = (mode, fn) => new Promise(res => {
    if (!DB) return res(fn(null));
    try { const t = DB.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q?.result); t.onerror = () => res(undefined); }
    catch { res(undefined); }
  });
  const get = k => DB ? tx('readonly', s => s.get(k)) : Promise.resolve(mem.get(k));
  const set = (k, v) => DB ? tx('readwrite', s => s.put(v, k)) : (mem.set(k, v), Promise.resolve());
  const del = k => DB ? tx('readwrite', s => s.delete(k)) : (mem.delete(k), Promise.resolve());

  let samples = (await get('samples')) || [];
  let vocab = (await get('vocab')) || defaultVocab.slice();
  let clips = new Set((await get('clipList')) || []);
  return {
    modo: 'local',
    puedeEscribir: () => true,
    setClave() {},
    async cargarVocab() { return vocab.slice(); },
    async guardarVocab(v) { vocab = v.slice(); await set('vocab', vocab); },
    async cargarMuestras() { return samples.slice(); },
    async agregarMuestra(s) { samples.push(s); await set('samples', samples); },
    async agregarMuestras(list) { samples.push(...list); await set('samples', samples); },
    async borrarMuestras(sena) { samples = samples.filter(s => s.label !== sena); await set('samples', samples); },
    async cargarModelo() { return (await get('model')) || null; },
    async guardarModelo(m) { await set('model', m); },
    async listaVideos() { return [...clips]; },
    async cargarVideo(sena) { return get('clip:' + sena); },
    async guardarVideo(sena, blob) { await set('clip:' + sena, blob); clips.add(sena); await set('clipList', [...clips]); },
    async borrarVideo(sena) { await del('clip:' + sena); clips.delete(sena); await set('clipList', [...clips]); },
    async borrarTodo() {
      for (const c of clips) await del('clip:' + c);
      samples = []; clips = new Set(); vocab = defaultVocab.slice();
      await Promise.all([set('samples', samples), set('clipList', []), set('vocab', vocab), del('model')]);
    },
  };
}

// ---------- Nube (Supabase, por REST) ----------
function storeNube(defaultVocab) {
  let clave = '';
  try { clave = localStorage.getItem('mqh-clave') || ''; } catch {}
  const base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
  async function req(path, { method = 'GET', body, prefer, range } = {}) {
    const h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'x-equipo': clave };
    if (prefer) h.Prefer = prefer;
    if (range) h.Range = range;
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 401 || r.status === 403 || /row-level security/i.test(t)) throw new Error('Clave del equipo incorrecta (solo lectura).');
      throw new Error(`Servidor ${r.status}: ${t.slice(0, 160)}`);
    }
    return r.status === 204 || method === 'DELETE' || prefer?.includes('minimal') ? null : r.json();
  }
  async function todas(path) {
    const out = [], paso = 1000;
    for (let i = 0; ; i += paso) {
      const p = await req(path, { range: `${i}-${i + paso - 1}` });
      out.push(...p);
      if (p.length < paso) return out;
    }
  }
  const enc = encodeURIComponent;
  return {
    modo: 'nube',
    clave: () => clave,
    puedeEscribir: () => !!clave,
    setClave(c) { clave = c.trim(); try { localStorage.setItem('mqh-clave', clave); } catch {} },
    async probarClave() { return req('rpc/es_equipo', { method: 'POST', body: {} }); },
    async cargarVocab() {
      const r = await req('senas?select=nombre&order=orden.asc,creado.asc');
      return r.length ? r.map(x => x.nombre) : defaultVocab.slice();
    },
    async guardarVocab(v) {
      await req('senas?on_conflict=nombre', { method: 'POST', body: v.map((nombre, orden) => ({ nombre, orden })), prefer: 'resolution=merge-duplicates,return=minimal' });
      const actuales = (await req('senas?select=nombre')).map(x => x.nombre);
      const sobran = actuales.filter(n => !v.includes(n));
      if (sobran.length) await req(`senas?nombre=in.(${sobran.map(n => '"' + n.replace(/"/g, '\\"') + '"').map(enc).join(',')})`, { method: 'DELETE' });
    },
    async cargarMuestras() {
      return (await todas('muestras?select=sena,x&order=id.asc')).map(r => ({ label: r.sena, x: b64ToF32(r.x) }));
    },
    async agregarMuestra(s) { await this.agregarMuestras([s]); },
    async agregarMuestras(list) {
      for (let i = 0; i < list.length; i += 200)
        await req('muestras', { method: 'POST', body: list.slice(i, i + 200).map(s => ({ sena: s.label, x: f32ToB64(s.x) })), prefer: 'return=minimal' });
    },
    async borrarMuestras(sena) { await req('muestras?sena=eq.' + enc(sena), { method: 'DELETE' }); },
    async cargarModelo() {
      const r = await req('modelo?id=eq.1&select=datos');
      return r[0] ? decodeModel(r[0].datos) : null;
    },
    async guardarModelo(m) {
      await req('modelo?on_conflict=id', { method: 'POST', body: [{ id: 1, datos: encodeModel(m) }], prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async listaVideos() { return (await req('videos?select=sena')).map(r => r.sena); },
    async cargarVideo(sena) {
      const r = await req('videos?select=datos&sena=eq.' + enc(sena));
      return r[0] ? dataToBlob(r[0].datos) : null;
    },
    async guardarVideo(sena, blob) {
      await req('videos?on_conflict=sena', { method: 'POST', body: [{ sena, datos: await blobToData(blob) }], prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async borrarVideo(sena) { await req('videos?sena=eq.' + enc(sena), { method: 'DELETE' }); },
    async borrarTodo() {
      await req('muestras?id=gte.0', { method: 'DELETE' });
      await req('videos?sena=neq.', { method: 'DELETE' });
      await req('modelo?id=gte.0', { method: 'DELETE' });
      await req('senas?nombre=neq.', { method: 'DELETE' });
    },
  };
}

export async function crearStore(defaultVocab) {
  return SUPABASE_URL && SUPABASE_KEY ? storeNube(defaultVocab) : storeLocal(defaultVocab);
}
