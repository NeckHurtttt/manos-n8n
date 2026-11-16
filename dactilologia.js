// Dactilología LSB para el avatar: forma de la mano de cada letra y número, sacada con MediaPipe
// del abecedario publicado por Freddy Villca Villegas (MIT). Las letras con movimiento
// (CH, J, LL, Ñ, RR, Z) agregan su trazo.
import { T, F, D } from './ml.js';

let formas = null;
export async function cargarFormas(url = 'modelo/abecedario-formas.json') {
  if (formas) return formas;
  try { formas = await (await fetch(url)).json(); } catch { formas = {}; }
  if (!formas.Z && formas['1']) formas.Z = formas['1'];        // Z: índice extendido que dibuja la Z
  return formas;
}

// Trazos: desplazamiento (en anchos de hombro) en el cuadro k de T
const TRAZO = {
  J: k => { const t = k / (T - 1); return t < 0.55 ? [0, t * 0.5] : [-(t - 0.55) * 0.7, 0.27 + (t - 0.55) * 0.1]; },
  Z: k => { const t = k / (T - 1); const pts = [[0, 0], [-0.35, 0], [0, 0.3], [-0.35, 0.3]]; const s = Math.min(2.999, t * 3), i = Math.floor(s), u = s - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u]; },
  'Ñ': k => [Math.sin(k / (T - 1) * Math.PI * 4) * 0.07, 0],
  CH: k => [Math.sin(k / (T - 1) * Math.PI * 3) * 0.06, 0],
  LL: k => [-(k / (T - 1)) * 0.35, 0],
  RR: k => [-(k / (T - 1)) * 0.35, 0],
  '10': k => [Math.sin(k / (T - 1) * Math.PI * 4) * 0.06, 0],
};

// Divide una palabra en letras de la dactilología (con CH, LL, RR como una sola).
export function letrasDe(palabra) {
  const w = palabra.toUpperCase().normalize('NFD').replace(/Ñ/g, 'Ñ').replace(/[̀-ͯ]/g, '');
  if (/^\d+$/.test(w)) return Number(w) >= 1 && Number(w) <= 10 ? [w] : w.split('').map(d => d === '0' ? 'O' : d);
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const dos = w.slice(i, i + 2);
    if (['CH', 'LL', 'RR'].includes(dos)) { out.push(dos); i++; continue; }
    if (/[A-ZÑ0-9]/.test(w[i])) out.push(w[i]);
  }
  return out;
}
export const hayForma = l => !!formas?.[l];

// Prototipo (mismo formato que el modelo del equipo) para que el avatar haga la letra con la mano derecha.
export function protoLetra(l) {
  const f = formas?.[l]; if (!f) return null;
  const x = new Float32Array(D), tr = TRAZO[l];
  for (let k = 0; k < T; k++) {
    const o = k * F, [dx, dy] = tr ? tr(k) : [0, 0];
    for (let j = 0; j < 21; j++) {
      x[o + j * 3] = -f[j][0];          // el avatar dibuja en espejo: así se ve como en el abecedario
      x[o + j * 3 + 1] = f[j][1];
      x[o + j * 3 + 2] = f[j][2];
    }
    x[o + 63] = 0.55 + dx;              // mano derecha del avatar, al lado de la cara
    x[o + 64] = 0.78 + dy;
    x[o + 65] = 1;
  }
  return x;
}
