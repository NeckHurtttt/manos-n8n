import { FilesetResolver, HandLandmarker, PoseLandmarker, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { frameFeat, resample, hasHand, train, predict, matchSigns, WIN_MS, REPOSO, D } from './ml.js';
import { IDIOMAS, traducir, alias } from './idiomas.js';

const $ = s => document.querySelector(s);
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const DEFAULT_VOCAB = [REPOSO, 'hola', 'gracias', 'por favor', 'sí', 'no', 'no entiendo', 'repita', 'más despacio',
  'pregunta', 'ayuda', 'baño', 'dolor', 'agua', 'médico', 'emergencia', 'profesor', 'terminé', 'tarea', 'examen',
  'escribir', 'leer', 'bien', 'mal', 'perdón', 'qué', 'cómo', 'dónde', 'nombre', 'mamá', 'papá'];
const RAPIDAS = ['no entiendo', 'repita', 'más despacio', 'baño', 'pregunta', 'terminé', 'dolor', 'ayuda', 'gracias'];

// ---------- Idioma ----------
let lang = 'es';
try { lang = localStorage.getItem('mqh-idioma') || 'es'; } catch {}
if (!IDIOMAS[lang]) lang = 'es';
const tr = w => traducir(w, lang);

// ---------- Guardado local (IndexedDB, con respaldo en memoria) ----------
const DB = await new Promise(res => {
  try {
    const r = indexedDB.open('manos-que-hablan', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch { res(null); }
});
const mem = new Map();
const kv = {
  get: k => DB ? new Promise(res => { try { const q = DB.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(mem.get(k)); } }) : Promise.resolve(mem.get(k)),
  set: (k, v) => DB ? new Promise(res => { try { const t = DB.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = t.onerror = () => res(); } catch { mem.set(k, v); res(); } }) : (mem.set(k, v), Promise.resolve()),
  del: k => DB ? new Promise(res => { try { const t = DB.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = t.onerror = () => res(); } catch { mem.delete(k); res(); } }) : (mem.delete(k), Promise.resolve()),
};

let vocab = (await kv.get('vocab')) || DEFAULT_VOCAB.slice();
if (!vocab.includes(REPOSO)) vocab.unshift(REPOSO);
let samples = (await kv.get('samples')) || [];
let model = (await kv.get('model')) || null;
let clips = new Set((await kv.get('clipList')) || []);
let selected = vocab.find(v => v !== REPOSO) || REPOSO;
let tab = 'clase';

const saveSamples = () => kv.set('samples', samples);
const saveVocab = () => kv.set('vocab', vocab);
const saveClips = () => kv.set('clipList', [...clips]);
const count = l => samples.reduce((n, s) => n + (s.label === l), 0);
const setEstado = (el, txt, cls = '') => { el.textContent = txt; el.className = 'estado ' + cls; };

// ---------- Cámara y MediaPipe ----------
const video = $('#video'), canvas = $('#overlay'), ctx = canvas.getContext('2d');
let hands = null, pose = null, drawer = null, stream = null, running = false;
const frames = []; // {t, f}
let lastPose = null, frameNo = 0, lastVideoTime = -1;

async function startCamera() {
  const btn = $('#btnCam'), est = $('#estadoCam');
  btn.disabled = true;
  try {
    setEstado(est, 'Cargando el modelo de manos…');
    const fs = await FilesetResolver.forVisionTasks(WASM);
    const opt = path => ({ baseOptions: { modelAssetPath: path, delegate: 'GPU' }, runningMode: 'VIDEO' });
    hands = await HandLandmarker.createFromOptions(fs, { ...opt(HAND_MODEL), numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })
      .catch(() => HandLandmarker.createFromOptions(fs, { ...opt(HAND_MODEL), baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' }, numHands: 2 }));
    setEstado(est, 'Cargando el modelo del cuerpo…');
    pose = await PoseLandmarker.createFromOptions(fs, opt(POSE_MODEL))
      .catch(() => PoseLandmarker.createFromOptions(fs, { ...opt(POSE_MODEL), baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' } }))
      .catch(() => null);
    setEstado(est, 'Pidiendo permiso para la cámara…');
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    drawer = new DrawingUtils(ctx);
    $('#camVacia').hidden = true;
    running = true;
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    setEstado(est, location.protocol === 'file:' ? 'Abre la app con un servidor (ver LEEME.md): la cámara no funciona desde file://.' : 'No se pudo iniciar: ' + (e.message || e), 'error');
  }
}
$('#btnCam').onclick = startCamera;

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const now = performance.now();
  const hr = hands.detectForVideo(video, now);
  if (pose && (frameNo++ % 3 === 0 || !lastPose)) lastPose = pose.detectForVideo(video, now);
  frames.push({ t: now, f: frameFeat(hr, lastPose) });
  while (frames.length && frames[0].t < now - WIN_MS * 1.6) frames.shift();
  draw(hr);
  if (tab === 'clase' && !capturing) recognize(now);
}

function draw(hr) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a3d';
  for (const lm of hr.landmarks) {
    drawer.drawConnectors(lm, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 4 });
    drawer.drawLandmarks(lm, { color: '#fff', fillColor: color, radius: 4, lineWidth: 1 });
  }
}

function windowFrames(from, to) {
  const fr = frames.filter(x => x.t >= from && x.t <= to);
  if (fr.length < 5) return null;
  return { x: resample(fr), present: fr.filter(x => hasHand(x.f)).length / fr.length };
}

// ---------- Reconocimiento (Alumno) ----------
const STABLE = 4;
let stable = { label: null, n: 0 }, lastEmit = { label: null, t: 0 }, sentence = [];
let umbral = 0.75;

function recognize(now) {
  if (!model) return;
  const w = windowFrames(now - WIN_MS, now);
  if (!w || w.present < 0.6) { stable = { label: null, n: 0 }; showBars(null); return; }
  const r = predict(model, w.x);
  showBars(r);
  const { label, p } = r[0];
  if (label === REPOSO || p < umbral) { stable = { label: null, n: 0 }; return; }
  stable = stable.label === label ? { label, n: stable.n + 1 } : { label, n: 1 };
  const repetida = lastEmit.label === label && now - lastEmit.t < 1800;
  if (stable.n >= STABLE && !repetida && now - lastEmit.t > 700) {
    lastEmit = { label, t: now };
    stable = { label: null, n: 0 };
    frames.length = 0;
    addWord(label);
  }
}

function showBars(r) {
  const el = $('#barras');
  if (!r) { el.innerHTML = model && running && tab === 'clase' ? '<p class="estado">Esperando manos…</p>' : ''; return; }
  el.innerHTML = r.slice(0, 3).map(({ label, p }) =>
    `<div class="barra"><span class="n">${esc(label)}</span><span class="b"><i style="width:${(p * 100).toFixed(0)}%"></i></span><span class="p">${(p * 100).toFixed(0)}%</span></div>`).join('');
}

function addWord(w) {
  sentence.push(w);
  renderSentence();
  if ($('#autoVoz').checked) speak(tr(w));
  if (navigator.vibrate) navigator.vibrate(30);
}
function renderSentence() {
  const f = $('#frase');
  f.dir = IDIOMAS[lang].rtl ? 'rtl' : 'ltr';
  f.innerHTML = sentence.length ? sentence.map(w => `<span class="w" title="${esc(w)}">${esc(tr(w))}</span>`).join('') : '<span class="ph">Las señas reconocidas aparecen aquí…</span>';
}
$('#btnHablar').onclick = () => sentence.length && speak(sentence.map(tr).join(' '));
$('#btnDeshacer').onclick = () => { sentence.pop(); renderSentence(); };
$('#btnBorrar').onclick = () => { sentence = []; renderSentence(); };
$('#umbral').oninput = e => { umbral = e.target.value / 100; $('#umbralTxt').textContent = e.target.value + ' %'; };
function renderRapidas() { $('#rapidas').innerHTML = RAPIDAS.map(t => `<button data-w="${esc(t)}">${esc(tr(t))}</button>`).join(''); }
$('#rapidas').onclick = e => { const w = e.target.dataset?.w; if (w) { sentence.push(w); renderSentence(); speak(tr(w)); } };

let voz = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  const es = vs.find(v => /es[-_](BO|419|MX|US|AR|CL|PE|CO)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  const code = IDIOMAS[lang].voz;
  // Quechua, aymara y guaraní no tienen voz en los navegadores: se leen con voz en castellano.
  voz = code ? (vs.find(v => v.lang.toLowerCase().startsWith(code)) || null) : es;
  const aviso = $('#avisoIdioma');
  if (aviso) aviso.textContent = [
    IDIOMAS[lang].validar ? '⚠ Traducción en borrador: valídala con un hablante.' : '',
    !IDIOMAS[lang].voz ? 'Se lee con voz en castellano.' : (code && !voz && vs.length ? 'Este equipo no tiene voz en este idioma.' : ''),
  ].filter(Boolean).join(' ');
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(t) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = voz?.lang || (IDIOMAS[lang].voz === 'en' ? 'en-US' : IDIOMAS[lang].voz === 'he' ? 'he-IL' : 'es-ES'); if (voz) u.voice = voz; u.rate = 0.95;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- Profesor: voz → subtítulos + señas ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, escuchando = false, finalTxt = '';
const queue = []; let playing = false;

if (!SR) setEstado($('#estadoVoz'), 'Este navegador no reconoce voz (usa Chrome o Edge). Puedes escribir la frase.', 'error');
$('#btnEscuchar').onclick = () => {
  if (!SR) return;
  if (escuchando) { escuchando = false; rec.stop(); return; }
  rec = new SR();
  rec.lang = IDIOMAS[lang].sr || 'es-BO'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) { finalTxt = (finalTxt + ' ' + t).trim().split(' ').slice(-40).join(' '); showSigns(t); }
      else interim += t;
    }
    $('#subtitulo').innerHTML = esc(finalTxt) + (interim ? ` <span class="interino">${esc(interim)}</span>` : '') || '<span class="ph">Subtítulos en vivo</span>';
  };
  rec.onerror = e => setEstado($('#estadoVoz'), 'Micrófono: ' + e.error, 'error');
  rec.onend = () => { if (escuchando) { try { rec.start(); } catch {} } else { $('#btnEscuchar').textContent = '🎙️ Escuchar'; setEstado($('#estadoVoz'), ''); } };
  rec.start(); escuchando = true;
  $('#btnEscuchar').textContent = '⏹ Detener';
  setEstado($('#estadoVoz'), 'Escuchando…', 'ok');
};
$('#formTexto').onsubmit = e => {
  e.preventDefault();
  const t = $('#textoManual').value.trim(); if (!t) return;
  finalTxt = t; $('#subtitulo').textContent = t; showSigns(t); $('#textoManual').value = '';
};

function showSigns(text) {
  const m = matchSigns(text, vocab, alias(lang));
  $('#fichas').innerHTML = m.map((x, i) => `<span class="ficha ${x.label && clips.has(x.label) ? 'si' : ''}" data-i="${i}" title="${x.label ? (clips.has(x.label) ? 'tiene video' : 'seña sin video grabado') : 'no está en el vocabulario'}">${esc(x.text)}</span>`).join('');
  m.forEach((x, i) => { if (x.label && clips.has(x.label)) queue.push({ label: x.label, i }); });
  if (!playing) playNext();
}
async function playNext() {
  const item = queue.shift();
  const clip = $('#clip');
  document.querySelectorAll('.ficha.ahora').forEach(f => f.classList.remove('ahora'));
  if (!item) { playing = false; $('#clipLabel').textContent = ''; return; }
  playing = true;
  const blob = await kv.get('clip:' + item.label);
  if (!blob) return playNext();
  document.querySelector(`.ficha[data-i="${item.i}"]`)?.classList.add('ahora');
  if (clip.src) URL.revokeObjectURL(clip.src);
  clip.src = URL.createObjectURL(blob);
  $('#clipLabel').textContent = tr(item.label);
  clip.playbackRate = 1;
  clip.onended = clip.onerror = () => setTimeout(playNext, 150);
  clip.play().catch(() => setTimeout(playNext, 150));
}

// ---------- Entrenar ----------
let capturing = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function countdown(n) {
  const c = $('#cuenta'); c.hidden = false;
  for (let i = n; i > 0; i--) { c.textContent = i; await sleep(650); }
  c.hidden = true;
}
function needCam() { if (running) return true; setEstado($('#estadoGrab'), 'Primero enciende la cámara.', 'error'); return false; }
function busy(b) { ['#btnUna', '#btnDiez', '#btnVideo', '#btnBorrarSena', '#btnEntrenar'].forEach(s => $(s).disabled = b); }

async function grabar(n) {
  if (!needCam()) return;
  busy(true); capturing = true;
  let ok = 0;
  try {
    for (let k = 0; k < n; k++) {
      setEstado($('#estadoGrab'), `«${selected}»: muestra ${k + 1} de ${n}. Prepárate…`);
      await countdown(k === 0 ? 3 : 2);
      $('#rec').hidden = false;
      const t0 = performance.now();
      await sleep(WIN_MS + 60);
      $('#rec').hidden = true;
      const w = windowFrames(t0, t0 + WIN_MS + 60);
      if (!w) { setEstado($('#estadoGrab'), 'La cámara va lenta; no se guardó.', 'error'); await sleep(900); continue; }
      if (selected !== REPOSO && w.present < 0.5) { setEstado($('#estadoGrab'), 'No vi las manos: muestra no guardada.', 'error'); await sleep(900); continue; }
      samples.push({ label: selected, x: w.x }); ok++;
      renderSenas();
      await sleep(250);
    }
    await saveSamples();
    setEstado($('#estadoGrab'), `Listo: ${ok} muestra(s) de «${selected}». Total: ${count(selected)}.`, 'ok');
    marcarModeloViejo();
  } finally { capturing = false; busy(false); $('#cuenta').hidden = true; $('#rec').hidden = true; }
}
$('#btnUna').onclick = () => grabar(1);
$('#btnDiez').onclick = () => grabar(10);

$('#btnVideo').onclick = async () => {
  if (!needCam()) return;
  if (selected === REPOSO) return setEstado($('#estadoGrab'), '«reposo» no necesita video.', 'error');
  if (!window.MediaRecorder) return setEstado($('#estadoGrab'), 'Este navegador no puede grabar video.', 'error');
  busy(true);
  try {
    setEstado($('#estadoGrab'), `Video de «${selected}»: haz la seña clara, una vez.`);
    await countdown(3);
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 1_200_000 } : undefined);
    const parts = []; mr.ondataavailable = e => e.data.size && parts.push(e.data);
    const done = new Promise(r => mr.onstop = r);
    $('#rec').hidden = false; mr.start(); await sleep(2200); mr.stop(); await done; $('#rec').hidden = true;
    await kv.set('clip:' + selected, new Blob(parts, { type: mr.mimeType || 'video/webm' }));
    clips.add(selected); await saveClips();
    renderSenas();
    setEstado($('#estadoGrab'), `Video de «${selected}» guardado. Se verá en el modo Profesor.`, 'ok');
  } catch (e) { setEstado($('#estadoGrab'), 'No se pudo grabar: ' + e.message, 'error'); }
  finally { busy(false); $('#rec').hidden = true; }
};

$('#btnBorrarSena').onclick = async () => {
  const n = count(selected);
  if (!n || !confirm(`¿Borrar las ${n} muestras de «${selected}»?`)) return;
  samples = samples.filter(s => s.label !== selected);
  await saveSamples(); renderSenas(); marcarModeloViejo();
  setEstado($('#estadoGrab'), `Muestras de «${selected}» borradas.`);
};

$('#btnEntrenar').onclick = async () => {
  const est = $('#estadoModelo'), bar = $('#progreso');
  if (!count(REPOSO)) return setEstado(est, 'Graba primero algunas muestras de «reposo» (sin hacer señas).', 'error');
  busy(true);
  try {
    const m = await train(samples, vocab, s => {
      bar.style.width = (s.ep / s.epochs * 100) + '%';
      setEstado(est, `Entrenando… ${s.ep}/${s.epochs} · acierto ${(s.acc * 100).toFixed(0)} %` + (s.vacc != null ? ` · en muestras no vistas ${(s.vacc * 100).toFixed(0)} %` : ''));
    });
    model = m; await kv.set('model', m);
    setEstado(est, describeModel(), 'ok');
    renderModelo();
  } catch (e) { setEstado(est, e.message, 'error'); }
  finally { busy(false); }
};

function describeModel() {
  if (!model) return 'Sin modelo todavía.';
  const s = model.stats || {};
  const v = s.vacc != null ? ` · acierta ${(s.vacc * 100).toFixed(0)} % en muestras que no vio` : '';
  return `Modelo con ${model.labels.length - (model.labels.includes(REPOSO) ? 1 : 0)} señas y ${s.n || '?'} muestras${v}.`;
}
function marcarModeloViejo() { if (model) setEstado($('#estadoModelo'), describeModel() + ' Hay muestras nuevas: vuelve a entrenar.'); }
function renderModelo() { $('#sinModelo').hidden = !!model; }

function renderSenas() {
  $('#senas').innerHTML = vocab.map(v => {
    const n = count(v);
    return `<button data-v="${esc(v)}" aria-pressed="${v === selected}"><span>${esc(v)}${clips.has(v) ? ' 🎬' : ''}</span><span class="c ${n >= 15 ? 'lista' : ''}">${n}</span></button>`;
  }).join('');
  renderVocab();
}
$('#senas').onclick = e => { const b = e.target.closest('button'); if (!b) return; selected = b.dataset.v; renderSenas(); setEstado($('#estadoGrab'), selected === REPOSO ? '«reposo»: manos quietas, abajo, acomodándote o rascándote. Sin señas.' : ''); };

// ---------- Datos ----------
function renderVocab() {
  $('#vocab').innerHTML = vocab.map(v => `<li>${esc(v)}<span>${count(v)} muestras${clips.has(v) ? ' · video' : ''}</span>${v === REPOSO ? '' : `<button data-del="${esc(v)}" aria-label="Quitar ${esc(v)}">✕</button>`}</li>`).join('');
}
$('#vocab').onclick = async e => {
  const v = e.target.dataset?.del; if (!v) return;
  if (!confirm(`¿Quitar «${v}» con sus muestras y su video?`)) return;
  vocab = vocab.filter(x => x !== v); samples = samples.filter(s => s.label !== v);
  clips.delete(v); await kv.del('clip:' + v);
  if (selected === v) selected = REPOSO;
  await Promise.all([saveVocab(), saveSamples(), saveClips()]);
  renderSenas(); marcarModeloViejo();
};
$('#formSena').onsubmit = async e => {
  e.preventDefault();
  const v = $('#nuevaSena').value.trim().toLowerCase(); if (!v) return;
  if (!vocab.includes(v)) { vocab.push(v); await saveVocab(); }
  $('#nuevaSena').value = ''; selected = v; renderSenas();
};

const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$('#btnExportar').onclick = async () => {
  const out = { app: 'manos-que-hablan', v: 1, D, vocab, samples: samples.map(s => ({ l: s.label, x: Array.from(s.x, v => Math.round(v * 1000) / 1000) })), clips: {} };
  if ($('#conVideos').checked) for (const c of clips) { const b = await kv.get('clip:' + c); if (b) out.clips[c] = await blobToData(b); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `senas-lsb-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  setEstado($('#estadoDatos'), `Exportadas ${samples.length} muestras y ${Object.keys(out.clips).length} videos.`, 'ok');
};
$('#archivo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'manos-que-hablan' || d.D !== D) throw new Error('el archivo no es de esta app o de otra versión');
    for (const v of d.vocab || []) if (!vocab.includes(v)) vocab.push(v);
    for (const s of d.samples || []) samples.push({ label: s.l, x: Float32Array.from(s.x) });
    let nc = 0;
    for (const [c, url] of Object.entries(d.clips || {})) { await kv.set('clip:' + c, await (await fetch(url)).blob()); clips.add(c); nc++; }
    await Promise.all([saveVocab(), saveSamples(), saveClips()]);
    renderSenas(); marcarModeloViejo();
    setEstado($('#estadoDatos'), `Sumadas ${d.samples?.length || 0} muestras y ${nc} videos. Vuelve a entrenar el modelo.`, 'ok');
  } catch (err) { setEstado($('#estadoDatos'), 'No se pudo importar: ' + err.message, 'error'); }
  e.target.value = '';
};
$('#btnReset').onclick = async () => {
  if (!confirm('¿Borrar TODAS las muestras, videos y el modelo? Exporta antes si quieres conservarlos.')) return;
  for (const c of clips) await kv.del('clip:' + c);
  vocab = DEFAULT_VOCAB.slice(); samples = []; model = null; clips = new Set();
  await Promise.all([saveVocab(), saveSamples(), saveClips(), kv.del('model')]);
  selected = vocab[1]; renderSenas(); renderModelo(); setEstado($('#estadoModelo'), describeModel());
  setEstado($('#estadoDatos'), 'Todo borrado.');
};

// ---------- Pestañas ----------
document.querySelector('.tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab);
  document.querySelector('.grid').classList.toggle('solo-panel', tab === 'datos' || tab === 'profe');
  showBars(null);
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const sel = $('#idioma');
sel.innerHTML = Object.entries(IDIOMAS).map(([k, v]) => `<option value="${k}">${esc(v.nombre)}${v.validar ? ' (borrador)' : ''}</option>`).join('');
sel.value = lang;
sel.onchange = () => {
  lang = sel.value;
  try { localStorage.setItem('mqh-idioma', lang); } catch {}
  pickVoice(); renderSentence(); renderRapidas();
  $('#subtitulo').dir = IDIOMAS[lang].rtl ? 'rtl' : 'ltr';
  if (escuchando) { escuchando = false; rec.stop(); }
};
renderRapidas(); pickVoice();
renderSenas(); renderModelo(); renderSentence();
setEstado($('#estadoModelo'), describeModel());
