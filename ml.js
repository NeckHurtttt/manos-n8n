// Núcleo sin navegador: rasgos de las manos, red neuronal pequeña y búsqueda de señas en texto.
// Se puede probar con Node (ver pruebas.mjs).

export const T = 10;          // cuadros por ventana
export const F = 132;         // rasgos por cuadro (2 manos × 66)
export const D = T * F;       // tamaño de la entrada
export const H = 64;          // neuronas ocultas
export const WIN_MS = 1000;   // una seña ≈ 1 segundo
export const REPOSO = 'reposo';

// Un cuadro: forma de cada mano (relativa a la muñeca y a su tamaño) + dónde está la mano respecto a la cara.
export function frameFeat(hands, pose) {
  const f = new Float32Array(F);
  let cx = 0.5, cy = 0.4, sw = 0.25;
  const p = pose && pose.landmarks && pose.landmarks[0];
  if (p && p[0] && p[11] && p[12]) {
    cx = p[0].x; cy = p[0].y;
    sw = Math.max(0.05, Math.hypot(p[11].x - p[12].x, p[11].y - p[12].y));
  }
  const slots = [null, null];
  (hands?.landmarks || []).forEach((lm, i) => {
    const name = hands.handedness?.[i]?.[0]?.categoryName;
    let s = name === 'Left' ? 1 : 0;
    if (slots[s]) s = 1 - s;
    if (!slots[s]) slots[s] = lm;
  });
  slots.forEach((lm, s) => {
    if (!lm) return;
    const o = s * 66, w = lm[0];
    const sc = Math.max(1e-3, Math.hypot(lm[9].x - w.x, lm[9].y - w.y));
    for (let j = 0; j < 21; j++) {
      f[o + j * 3] = (lm[j].x - w.x) / sc;
      f[o + j * 3 + 1] = (lm[j].y - w.y) / sc;
      f[o + j * 3 + 2] = (lm[j].z - w.z) / sc;
    }
    f[o + 63] = (w.x - cx) / sw;
    f[o + 64] = (w.y - cy) / sw;
    f[o + 65] = 1;
  });
  return f;
}

export const hasHand = f => f[65] > 0 || f[131] > 0;

// Lleva una lista de cuadros {f} a exactamente T cuadros.
export function resample(frames) {
  const out = new Float32Array(D), n = frames.length;
  for (let k = 0; k < T; k++) {
    const pos = n === 1 ? 0 : k * (n - 1) / (T - 1);
    const i = Math.floor(pos), a = pos - i;
    const A = frames[i].f, B = frames[Math.min(n - 1, i + 1)].f;
    for (let d = 0; d < F; d++) out[k * F + d] = A[d] * (1 - a) + B[d] * a;
  }
  return out;
}

function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export const argmax = a => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

function rand(n, s) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * s; return a; }

function forward(m, x, h, o) {
  const C = m.labels.length;
  h.set(m.b1);
  for (let d = 0; d < D; d++) {
    const xv = x[d]; if (xv === 0) continue;
    const off = d * H;
    for (let j = 0; j < H; j++) h[j] += xv * m.W1[off + j];
  }
  for (let j = 0; j < H; j++) if (h[j] < 0) h[j] = 0;
  o.set(m.b2);
  for (let j = 0; j < H; j++) {
    const hv = h[j]; if (!hv) continue;
    const off = j * C;
    for (let c = 0; c < C; c++) o[c] += hv * m.W2[off + c];
  }
  let mx = -Infinity; for (let c = 0; c < C; c++) if (o[c] > mx) mx = o[c];
  let s = 0; for (let c = 0; c < C; c++) { o[c] = Math.exp(o[c] - mx); s += o[c]; }
  for (let c = 0; c < C; c++) o[c] /= s;
  return o;
}

function standardize(m, x, z = new Float32Array(D)) {
  for (let d = 0; d < D; d++) z[d] = (x[d] - m.mean[d]) / m.std[d];
  return z;
}

// Devuelve [{label, p}] ordenado de mayor a menor.
export function predict(m, x) {
  const z = standardize(m, x), h = new Float32Array(H), o = new Float32Array(m.labels.length);
  forward(m, z, h, o);
  return m.labels.map((label, i) => ({ label, p: o[i] })).sort((a, b) => b.p - a.p);
}

// samples: [{label, x: Float32Array(D)}]; labels en el orden del vocabulario.
export async function train(samples, order, onProgress = () => {}, { epochs = 40, lr = 0.002 } = {}) {
  const labels = order.filter(l => samples.some(s => s.label === l));
  if (labels.length < 2) throw new Error('Necesitas muestras de al menos 2 señas (incluye «reposo»).');
  const idx = new Map(labels.map((l, i) => [l, i])), C = labels.length;
  const data = shuffle(samples.filter(s => idx.has(s.label)).slice());

  // 20 % para validar si hay suficientes datos (estratificado por seña).
  const val = [], tr = [];
  const seen = new Map();
  for (const s of data) {
    const total = data.filter(d => d.label === s.label).length;
    const k = seen.get(s.label) || 0; seen.set(s.label, k + 1);
    (total >= 6 && k < Math.floor(total * 0.2) ? val : tr).push(s);
  }

  const mean = new Float32Array(D), std = new Float32Array(D);
  for (const s of tr) for (let d = 0; d < D; d++) mean[d] += s.x[d];
  for (let d = 0; d < D; d++) mean[d] /= tr.length;
  for (const s of tr) for (let d = 0; d < D; d++) { const v = s.x[d] - mean[d]; std[d] += v * v; }
  const active = new Uint8Array(D);
  for (let d = 0; d < D; d++) { const sd = Math.sqrt(std[d] / tr.length); active[d] = sd > 1e-6 ? 1 : 0; std[d] = Math.max(0.05, sd); }

  const m = {
    v: 1, T, F, H, labels, mean, std,
    W1: rand(D * H, Math.sqrt(6 / (D + H))), b1: new Float32Array(H),
    W2: rand(H * C, Math.sqrt(6 / (H + C))), b2: new Float32Array(C),
  };
  const X = tr.map(s => standardize(m, s.x)), Y = tr.map(s => idx.get(s.label));
  const P = [m.W1, m.b1, m.W2, m.b2];
  const M = P.map(p => new Float32Array(p.length)), V = P.map(p => new Float32Array(p.length)), G = P.map(p => new Float32Array(p.length));
  const B1 = 0.9, B2 = 0.999, EPS = 1e-8, L2 = 1e-4, BS = 16;
  const h = new Float32Array(H), o = new Float32Array(C), dh = new Float32Array(H), xa = new Float32Array(D);
  const ord = X.map((_, i) => i);
  let step = 0, last = {};

  for (let ep = 0; ep < epochs; ep++) {
    shuffle(ord);
    let loss = 0, ok = 0;
    for (let b = 0; b < ord.length; b += BS) {
      G.forEach(g => g.fill(0));
      const batch = ord.slice(b, b + BS);
      for (const i of batch) {
        const x = X[i];
        for (let d = 0; d < D; d++) xa[d] = active[d] ? x[d] + gauss() * 0.15 : x[d];
        forward(m, xa, h, o);
        loss -= Math.log(o[Y[i]] + 1e-9);
        if (argmax(o) === Y[i]) ok++;
        o[Y[i]] -= 1;
        for (let j = 0; j < H; j++) {
          dh[j] = 0;
          if (h[j] <= 0) continue;
          const off = j * C; let s = 0;
          for (let c = 0; c < C; c++) { G[2][off + c] += h[j] * o[c]; s += m.W2[off + c] * o[c]; }
          dh[j] = s;
        }
        for (let c = 0; c < C; c++) G[3][c] += o[c];
        for (let d = 0; d < D; d++) {
          const xv = xa[d]; if (xv === 0) continue;
          const off = d * H;
          for (let j = 0; j < H; j++) if (dh[j]) G[0][off + j] += xv * dh[j];
        }
        for (let j = 0; j < H; j++) G[1][j] += dh[j];
      }
      step++;
      const n = batch.length, c1 = 1 - B1 ** step, c2 = 1 - B2 ** step;
      P.forEach((p, k) => {
        const g = G[k], mm = M[k], vv = V[k];
        for (let q = 0; q < p.length; q++) {
          const gr = g[q] / n + L2 * p[q];
          mm[q] = B1 * mm[q] + (1 - B1) * gr;
          vv[q] = B2 * vv[q] + (1 - B2) * gr * gr;
          p[q] -= lr * (mm[q] / c1) / (Math.sqrt(vv[q] / c2) + EPS);
        }
      });
    }
    let vacc = null;
    if (val.length) vacc = val.filter(s => predict(m, s.x)[0].label === s.label).length / val.length;
    last = { ep: ep + 1, epochs, loss: loss / X.length, acc: ok / X.length, vacc, nval: val.length };
    onProgress(last);
    await new Promise(r => setTimeout(r, 0));
  }
  m.stats = { ...last, n: data.length, at: Date.now() };
  return m;
}

// ---------- Texto → señas ----------
export const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[¿?¡!.,;:"'()«»\-]/g, ' ').replace(/\s+/g, ' ').trim();

// Busca primero las frases más largas del vocabulario (hasta 4 palabras).
export function matchSigns(text, vocab) {
  const map = new Map(vocab.filter(v => v !== REPOSO).map(v => [norm(v), v]));
  const w = norm(text).split(' ').filter(Boolean), out = [];
  for (let i = 0; i < w.length;) {
    let hit = null;
    for (let n = Math.min(4, w.length - i); n >= 1; n--) {
      const k = w.slice(i, i + n).join(' ');
      if (map.has(k)) { hit = { text: w.slice(i, i + n).join(' '), label: map.get(k), n }; break; }
      // plural simple: «tareas» → «tarea»
      if (n === 1 && k.length > 3 && k.endsWith('s') && map.has(k.slice(0, -1))) { hit = { text: k, label: map.get(k.slice(0, -1)), n: 1 }; break; }
    }
    if (hit) { out.push(hit); i += hit.n; } else { out.push({ text: w[i], label: null, n: 1 }); i++; }
  }
  return out;
}
