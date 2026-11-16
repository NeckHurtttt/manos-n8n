// Reconocedor base de LSB: modelo Transformer de Freddy Villca Villegas (MIT, 2024),
// entrenado con 5800 secuencias reales de 58 señas (abecedario, números y palabras).
// https://github.com/freddxvill/Proyecto_Traductor_de_la_LSB
// Aquí se reproduce en el navegador exactamente su preparación de datos (138 rasgos por cuadro, 30 cuadros).

export const CLASES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL', 'M', 'N', 'Ñ', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  ' ', 'HOLA', 'BUENOS DIAS', 'GRACIAS', 'POR FAVOR', 'YO', 'ABOGADO', 'DOCTOR', 'ELECTRICISTA', 'POLICIA', 'PRESIDENTE', 'PROFESOR',
  'NOMBRE', 'ES', 'MI', 'TRABAJO', 'LA PAZ', 'SUCRE', 'COCHABAMBA', 'VIVO'];
// Su clase 0 es la letra O (en la tabla del autor figura como «0/O»): se usa como letra.
CLASES[0] = 'O';

// Clase → palabra del vocabulario de la app
const PALABRA = { 'HOLA': 'hola', 'BUENOS DIAS': 'buenos días', 'GRACIAS': 'gracias', 'POR FAVOR': 'por favor', 'YO': 'yo',
  'ABOGADO': 'abogado', 'DOCTOR': 'médico', 'ELECTRICISTA': 'electricista', 'POLICIA': 'policía', 'PRESIDENTE': 'presidente',
  'PROFESOR': 'profesor', 'NOMBRE': 'nombre', 'ES': 'es', 'MI': 'mi', 'TRABAJO': 'trabajo', 'LA PAZ': 'La Paz', 'SUCRE': 'Sucre',
  'COCHABAMBA': 'Cochabamba', 'VIVO': 'vivo' };
export const PALABRAS_BASE = [...new Set(Object.values(PALABRA))];
export function aToken(clase) {
  if (clase === ' ') return { tipo: 'espacio' };
  if (PALABRA[clase]) return { tipo: 'palabra', texto: PALABRA[clase] };
  if (/^\d+$/.test(clase)) return { tipo: 'numero', texto: clase };
  return { tipo: 'letra', texto: clase.toLowerCase() };
}

const SEQ = 30, NF = 138, POSE = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const TAU = 2 * Math.PI;

// Igual que extraer_keypoints() del autor. «right_hand» = mano derecha de la persona, que MediaPipe Tasks
// etiqueta «Right» en la imagen sin espejo (verificado con fotos de cuerpo entero contra la pose).
export function rasgosBase(hands, pose) {
  let rh = null, lh = null;
  (hands?.landmarks || []).forEach((lm, i) => {
    const name = hands.handedness?.[i]?.[0]?.categoryName;
    if (name === 'Right' && !rh) rh = lm; else if (name === 'Left' && !lh) lh = lm; else if (!rh) rh = lm; else if (!lh) lh = lm;
  });
  const p = pose?.landmarks?.[0];
  const cx = p ? p[0].x : 0.5, cy = p ? p[0].y : 0.2;
  const f = new Float32Array(NF);
  let o = 0;
  const mano = lm => {
    if (!lm) { o += 42; return; }
    let mx = Infinity, my = Infinity;
    for (const q of lm) { if (q.x < mx) mx = q.x; if (q.y < my) my = q.y; }
    for (const q of lm) { f[o++] = q.x - mx; f[o++] = q.y - my; }
  };
  const dist = lm => { if (!lm) { o += 21; return; } for (const q of lm) f[o++] = Math.hypot(q.x - cx, q.y - cy); };
  mano(rh); dist(rh);
  if (p) for (const i of POSE) f[o++] = Math.atan2(p[i].y - cy, p[i].x - cx) / TAU; else o += 12;
  mano(lh); dist(lh);
  return { f, manos: (rh ? 1 : 0) + (lh ? 1 : 0) };
}

let ort = null, sesion = null, cargando = null;
function cargarScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('no se pudo cargar ' + src)); document.head.append(s); });
}
export async function cargarModeloBase(url = 'modelo/lsb-villca-v4.onnx') {
  if (sesion) return sesion;
  if (cargando) return cargando;
  cargando = (async () => {
    if (!window.ort) await cargarScript('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort.min.js');
    ort = window.ort;
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
    ort.env.wasm.numThreads = 1;
    sesion = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
    return sesion;
  })();
  try { return await cargando; } catch (e) { cargando = null; throw e; }
}
export const baseLista = () => !!sesion;

// cuadros: [{t, f}] de la última ~1,5 s → 30 cuadros por índice (como su captura a ~20 fps)
export async function predecirBase(cuadros) {
  if (!sesion || cuadros.length < 8) return null;
  const x = new Float32Array(SEQ * NF), n = cuadros.length;
  for (let k = 0; k < SEQ; k++) x.set(cuadros[Math.min(n - 1, Math.round(k * (n - 1) / (SEQ - 1)))].f, k * NF);
  const entrada = new ort.Tensor('float32', x, [1, SEQ, NF]);
  const nombre = sesion.inputNames[0];
  const out = await sesion.run({ [nombre]: entrada });
  const v = out[sesion.outputNames[0]].data;
  let mx = -Infinity; for (const z of v) if (z > mx) mx = z;
  const e = Array.from(v, z => Math.exp(z - mx)), s = e.reduce((a, b) => a + b, 0);
  return CLASES.map((c, i) => ({ clase: c, p: e[i] / s })).sort((a, b) => b.p - a.p);
}
