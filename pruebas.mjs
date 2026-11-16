// node pruebas.mjs — prueba el núcleo con manos sintéticas (sin cámara).
import assert from 'node:assert/strict';
import { frameFeat, resample, train, predict, matchSigns, D, F, hasHand } from './ml.js';
import { letrasDe } from './dactilologia.js';
import { rasgosBase, aToken, CLASES } from './lsb.js';

let fallos = 0;
const prueba = async (nombre, fn) => { try { await fn(); console.log('✓', nombre); } catch (e) { fallos++; console.log('✗', nombre, '\n ', e.message); } };

// Mano falsa: 21 puntos; «forma» abre o cierra los dedos, (px,py) mueve la muñeca.
function mano(forma, px, py) {
  const lm = [];
  for (let j = 0; j < 21; j++) {
    const dedo = Math.floor((j - 1) / 4), seg = (j - 1) % 4 + 1;
    if (j === 0) { lm.push({ x: px, y: py, z: 0 }); continue; }
    const ang = -Math.PI / 2 + (dedo - 2) * 0.3;
    const largo = seg * 0.02 * (1 - forma * (seg > 1 ? 0.6 : 0));
    lm.push({ x: px + Math.cos(ang) * largo, y: py + Math.sin(ang) * largo, z: forma * 0.01 * seg });
  }
  return lm;
}
const pose = { landmarks: [Array.from({ length: 33 }, (_, i) => i === 0 ? { x: 0.5, y: 0.3 } : i === 11 ? { x: 0.62, y: 0.5 } : i === 12 ? { x: 0.38, y: 0.5 } : { x: 0.5, y: 0.5 })] };
const r = s => (Math.random() - 0.5) * s;

// Tres «señas»: puño quieto junto a la cara, mano abierta que baja, y reposo (sin manos o mano abajo quieta).
function muestra(tipo) {
  const frames = [];
  const n = 12 + Math.floor(Math.random() * 10);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    let hands = { landmarks: [], handedness: [] };
    if (tipo === 'hola') hands = { landmarks: [mano(0.1 + r(0.1), 0.6 + r(0.03), 0.25 + 0.2 * t + r(0.03))], handedness: [[{ categoryName: 'Right' }]] };
    if (tipo === 'agua') hands = { landmarks: [mano(0.9 + r(0.1), 0.52 + r(0.03), 0.35 + r(0.03))], handedness: [[{ categoryName: 'Right' }]] };
    if (tipo === 'reposo' && Math.random() < 0.5) hands = { landmarks: [mano(0.5 + r(0.4), 0.6 + r(0.1), 0.8 + r(0.05))], handedness: [[{ categoryName: 'Right' }]] };
    frames.push({ f: frameFeat(hands, pose) });
  }
  return { label: tipo, x: resample(frames) };
}

await prueba('frameFeat marca la mano presente y normaliza la muñeca en 0', () => {
  const f = frameFeat({ landmarks: [mano(0, 0.5, 0.5)], handedness: [[{ categoryName: 'Right' }]] }, pose);
  assert.equal(f.length, F); assert.ok(hasHand(f)); assert.equal(f[0], 0); assert.equal(f[1], 0); assert.equal(f[131], 0);
});

await prueba('dos manos con la misma lateralidad usan los dos espacios', () => {
  const f = frameFeat({ landmarks: [mano(0, 0.4, 0.5), mano(0, 0.6, 0.5)], handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Right' }]] }, pose);
  assert.equal(f[65], 1); assert.equal(f[131], 1);
});

await prueba('resample deja exactamente D valores', () => {
  assert.equal(resample([{ f: new Float32Array(F).fill(1) }]).length, D);
});

await prueba('la red aprende 3 señas sintéticas (≥ 90 % en datos nuevos)', async () => {
  const datos = [];
  for (const t of ['reposo', 'hola', 'agua']) for (let i = 0; i < 25; i++) datos.push(muestra(t));
  const m = await train(datos, ['reposo', 'hola', 'agua'], () => {}, { epochs: 25 });
  let ok = 0, n = 0;
  for (const t of ['reposo', 'hola', 'agua']) for (let i = 0; i < 20; i++) { n++; if (predict(m, muestra(t).x)[0].label === t) ok++; }
  assert.ok(ok / n >= 0.9, `precisión ${(ok / n * 100).toFixed(0)} %`);
  console.log('   precisión en datos nuevos:', (ok / n * 100).toFixed(0) + ' %', '· validación interna:', m.stats.vacc);
});

await prueba('train exige al menos 2 señas', async () => {
  await assert.rejects(train([muestra('hola')], ['hola']));
});

await prueba('texto → señas: frases largas, tildes y plurales', () => {
  const v = ['reposo', 'no', 'no entiendo', 'tarea', 'qué', 'mañana', 'examen'];
  const r = matchSigns('¿Qué no entienden? Mañana hay examen y tareas.', v);
  assert.deepEqual(r.map(x => x.label), ['qué', 'no', null, 'mañana', null, 'examen', null, 'tarea']);
  assert.deepEqual(matchSigns('no entiendo', v).map(x => x.label), ['no entiendo']);
});

await prueba('deletreo: dígrafos CH/LL/RR, Ñ, tildes y números', () => {
  assert.deepEqual(letrasDe('Sergio'), ['S', 'E', 'R', 'G', 'I', 'O']);
  assert.deepEqual(letrasDe('Chullpa'), ['CH', 'U', 'LL', 'P', 'A']);
  assert.deepEqual(letrasDe('perro'), ['P', 'E', 'RR', 'O']);
  assert.deepEqual(letrasDe('Muñoz'), ['M', 'U', 'Ñ', 'O', 'Z']);
  assert.deepEqual(letrasDe('José'), ['J', 'O', 'S', 'E']);
  assert.deepEqual(letrasDe('10'), ['10']);
  assert.deepEqual(matchSigns('Me llamo Ñusta', ['reposo']).map(x => x.text), ['me', 'llamo', 'ñusta']);
  assert.deepEqual(letrasDe('205'), ['2', 'O', '5']);
});

await prueba('LSB base: 138 rasgos con la mano derecha primero (como el autor)', () => {
  assert.equal(CLASES.length, 58);
  const der = mano(0.1, 0.4, 0.5), izq = mano(0.9, 0.7, 0.6);
  const { f, manos } = rasgosBase({ landmarks: [izq, der], handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]] }, pose);
  assert.equal(f.length, 138); assert.equal(manos, 2);
  // x relativo al mínimo de la mano derecha: algún valor exactamente 0
  assert.ok(Array.from(f.slice(0, 42)).some(v => v === 0));
  // distancia de la muñeca derecha a la nariz (0.5, 0.3)
  assert.ok(Math.abs(f[42] - Math.hypot(0.4 - 0.5, 0.5 - 0.3)) < 1e-6);
  // ángulos de la pose en [-0.5, 0.5]
  for (let i = 63; i < 75; i++) assert.ok(f[i] >= -0.5 && f[i] <= 0.5);
  const sin = rasgosBase({ landmarks: [], handedness: [] }, null);
  assert.equal(sin.manos, 0); assert.ok(Array.from(sin.f).every(v => v === 0));
});

await prueba('LSB base: clases a palabras, letras y números', () => {
  assert.deepEqual(aToken('HOLA'), { tipo: 'palabra', texto: 'hola' });
  assert.deepEqual(aToken('DOCTOR'), { tipo: 'palabra', texto: 'médico' });
  assert.deepEqual(aToken('LL'), { tipo: 'letra', texto: 'll' });
  assert.deepEqual(aToken('7'), { tipo: 'numero', texto: '7' });
  assert.deepEqual(aToken(' '), { tipo: 'espacio' });
});

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
