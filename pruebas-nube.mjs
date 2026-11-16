// node pruebas-nube.mjs — prueba store.js (modo nube) contra un Supabase falso con la misma regla de clave.
import http from 'node:http';
import assert from 'node:assert/strict';
import { storeNube } from './store.js';

const CLAVE = 'clave-buena';
const db = { senas: [], muestras: [], videos: [], modelo: [] };
const PK = { senas: 'nombre', videos: 'sena', modelo: 'id', muestras: 'id' };
let nextId = 1;
const pedidos = [];

function filtrar(rows, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    rows = rows.filter(r => {
      const x = r[k];
      if (op === 'eq') return String(x) === val;
      if (op === 'neq') return String(x) !== val;
      if (op === 'gte') return Number(x) >= Number(val);
      if (op === 'in') return [...val.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map(m => m[1] != null ? m[1].replace(/\\(.)/g, '$1') : m[2]).includes(String(x));
      throw new Error('op ' + op);
    });
  }
  return rows;
}
const srv = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x'); const [, , , tabla] = u.pathname.split('/');
  pedidos.push(`${req.method} ${tabla}`);
  const equipo = req.headers['x-equipo'] === CLAVE;
  const json = (st, d) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)); };
  if (req.headers.apikey !== 'sb_publishable_prueba') return json(401, { message: 'sin apikey' });
  if (u.pathname.endsWith('/rpc/es_equipo')) return json(200, equipo);
  const q = [...u.searchParams];
  if (req.method === 'GET') {
    let rows = filtrar(db[tabla], q);
    const ord = u.searchParams.get('order');
    if (ord) { const c = ord.split(',')[0].split('.')[0]; rows = [...rows].sort((a, b) => (a[c] > b[c]) - (a[c] < b[c])); }
    const sel = u.searchParams.get('select');
    if (sel && sel !== '*') rows = rows.map(r => Object.fromEntries(sel.split(',').map(c => [c, r[c]])));
    const rg = req.headers.range?.split('-').map(Number);
    if (rg) rows = rows.slice(rg[0], rg[1] + 1);
    return json(200, rows);
  }
  if (req.method === 'POST') {
    if (!equipo) return json(403, { code: '42501', message: `new row violates row-level security policy for table "${tabla}"` });
    const filas = JSON.parse(body), merge = (req.headers.prefer || '').includes('merge-duplicates');
    for (const f of filas) {
      if (tabla === 'muestras') { db.muestras.push({ id: nextId++, ...f }); continue; }
      const i = db[tabla].findIndex(r => r[PK[tabla]] === f[PK[tabla]]);
      if (i >= 0) { if (!merge) return json(409, { message: 'duplicado' }); db[tabla][i] = { ...db[tabla][i], ...f }; }
      else db[tabla].push(f);
    }
    return json(201);
  }
  if (req.method === 'DELETE') {
    if (!q.length) return json(400, { message: 'DELETE requiere filtro' });
    if (!equipo) return json(204);                  // RLS: no borra nada, sin error
    const borrar = new Set(filtrar(db[tabla], q));
    db[tabla] = db[tabla].filter(r => !borrar.has(r));
    return json(204);
  }
  json(405, {});
});
await new Promise(r => srv.listen(0, r));
const URL_ = `http://127.0.0.1:${srv.address().port}`;
globalThis.localStorage = { getItem: () => null, setItem() {} };

let fallos = 0;
const prueba = async (n, fn) => { try { await fn(); console.log('✓', n); } catch (e) { fallos++; console.log('✗', n, '\n ', e.message); } };
const VOC = ['reposo', 'hola', 'gracias'];
const st = storeNube(VOC, URL_, 'sb_publishable_prueba');
const x = n => Float32Array.from({ length: 1320 }, (_, i) => (i * n) % 7 / 7);

await prueba('sin clave: lee, pero no puede escribir', async () => {
  assert.deepEqual(await st.cargarVocab(), VOC);
  assert.equal(await st.probarClave(), false);
  await assert.rejects(st.agregarMuestras([{ label: 'hola', x: x(1) }]), /Clave del equipo incorrecta/);
});
await prueba('con clave: guarda vocabulario, muestras (en lotes) y las lee iguales', async () => {
  st.setClave(CLAVE);
  assert.equal(await st.probarClave(), true);
  await st.guardarVocab([...VOC, 'agua potable']);
  assert.deepEqual(await st.cargarVocab(), [...VOC, 'agua potable']);
  const antes = pedidos.filter(p => p === 'POST muestras').length;
  const muchas = Array.from({ length: 450 }, (_, i) => ({ label: i % 2 ? 'hola' : 'reposo', x: x(i) }));
  await st.agregarMuestras(muchas);
  const leidas = await st.cargarMuestras();
  assert.equal(leidas.length, 450);
  assert.deepEqual(Array.from(leidas[7].x), Array.from(muchas[7].x));
  assert.equal(pedidos.filter(p => p === 'POST muestras').length - antes, 3, 'en lotes de 200');
});
await prueba('lee más de 1000 muestras por páginas', async () => {
  await st.agregarMuestras(Array.from({ length: 700 }, (_, i) => ({ label: 'gracias', x: x(i) })));
  assert.equal((await st.cargarMuestras()).length, 1150);
});
await prueba('quitar una seña con espacio y comillas del vocabulario', async () => {
  await st.guardarVocab([...VOC, 'di "hola"', 'agua potable']);
  await st.guardarVocab([...VOC, 'agua potable']);
  assert.deepEqual(await st.cargarVocab(), [...VOC, 'agua potable']);
});
await prueba('modelo: se publica y se recupera con sus pesos y prototipos', async () => {
  const m = { labels: ['reposo', 'hola'], mean: x(2), std: x(3), W1: x(4), b1: new Float32Array(64), W2: x(5).slice(0, 128), b2: new Float32Array(2), protos: { hola: x(6) }, stats: { vacc: 0.9 } };
  await st.guardarModelo(m);
  await st.guardarModelo(m);  // sobrescribe sin duplicar
  const r = await st.cargarModelo();
  assert.deepEqual(Array.from(r.W1), Array.from(m.W1));
  assert.deepEqual(Array.from(r.protos.hola), Array.from(m.protos.hola));
  assert.equal(db.modelo.length, 1);
});
await prueba('videos: guardar, listar, cargar y borrar', async () => {
  const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'video/webm' });
  await st.guardarVideo('hola', blob);
  assert.deepEqual(await st.listaVideos(), ['hola']);
  const b = await st.cargarVideo('hola');
  assert.deepEqual([...new Uint8Array(await b.arrayBuffer())], [1, 2, 3, 250]);
  await st.borrarVideo('hola');
  assert.deepEqual(await st.listaVideos(), []);
});
await prueba('borrar muestras de una seña y borrar todo', async () => {
  await st.borrarMuestras('gracias');
  assert.ok((await st.cargarMuestras()).every(s => s.label !== 'gracias'));
  await st.borrarTodo();
  assert.equal((await st.cargarMuestras()).length, 0);
  assert.equal(await st.cargarModelo(), null);
  assert.deepEqual(await st.cargarVocab(), VOC);
});
await prueba('con clave equivocada no borra nada', async () => {
  await st.agregarMuestras([{ label: 'hola', x: x(1) }]);
  st.setClave('mala');
  await st.borrarMuestras('hola');
  assert.equal((await st.cargarMuestras()).length, 1);
});

srv.close();
console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
