import { FilesetResolver, HandLandmarker, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { frameFeat, resample, hasHand, train, predict, matchSigns, norm, WIN_MS, REPOSO, D } from './ml.js';
import { IDIOMAS, TRAD, traducir, alias } from './idiomas.js';
import { Avatar } from './avatar.js';
import { rasgosBase, cargarModeloBase, predecirBase, aToken, PALABRAS_BASE, baseLista } from './lsb.js';
import { cargarFormas, letrasDe, hayForma, protoLetra } from './dactilologia.js';
import { crearStore, f32ToB64, b64ToF32 } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_CONN = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const META = 20;            // muestras recomendadas por seña
const MINIMO = 15;          // muestras para considerarla lista

const DEFAULT_VOCAB = [REPOSO, 'hola', 'gracias', 'por favor', 'sí', 'no', 'no entiendo', 'repita', 'más despacio',
  'pregunta', 'ayuda', 'baño', 'dolor', 'agua', 'médico', 'emergencia', 'profesor', 'terminé', 'tarea', 'examen',
  'escribir', 'leer', 'bien', 'mal', 'perdón', 'qué', 'cómo', 'dónde', 'nombre', 'mamá', 'papá',
  ...PALABRAS_BASE.filter(p => !['hola', 'gracias', 'por favor', 'profesor', 'nombre', 'médico'].includes(p))];
const RAPIDAS = ['no entiendo', 'repita', 'más despacio', 'baño', 'pregunta', 'terminé', 'dolor', 'ayuda', 'gracias'];

// ---------- Utilidades de interfaz ----------
function toast(msg, tipo = '', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast ' + tipo; t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
function chip(id, s, texto) { const c = $(id); c.dataset.s = s; if (texto != null) c.lastElementChild.textContent = texto; }
function nota(el, txt, cls = '') { el.textContent = txt; el.classList.remove('ok', 'error'); if (cls) el.classList.add(cls); }
const guardarPref = (k, v) => { try { localStorage.setItem('mqh-' + k, v); } catch {} };
const leerPref = (k, d) => { try { return localStorage.getItem('mqh-' + k) ?? d; } catch { return d; } };

// ---------- Idioma ----------
let lang = leerPref('idioma', 'es');
if (!IDIOMAS[lang]) lang = 'es';
const tr = w => traducir(w, lang);

// ---------- Datos ----------
const store = await crearStore(DEFAULT_VOCAB);
let vocab = DEFAULT_VOCAB.slice(), samples = [], model = null, clips = new Set(), muestrasCargadas = false;
let selected = 'hola', vista = 'vivo', modeloViejo = false;
const count = l => samples.reduce((n, s) => n + (s.label === l), 0);

async function cargarTodo() {
  chip('#chipNube', 'wait', store.modo === 'nube' ? 'conectando…' : 'local');
  try {
    [vocab, model, clips] = await Promise.all([store.cargarVocab(), store.cargarModelo(), store.listaVideos().then(l => new Set(l))]);
    if (!vocab.includes(REPOSO)) vocab.unshift(REPOSO);
    for (const p of PALABRAS_BASE) if (!vocab.includes(p)) vocab.push(p);
    if (!vocab.includes(selected)) selected = vocab.find(v => v !== REPOSO) || REPOSO;
    chip('#chipNube', 'on', store.modo === 'nube' ? 'nube del equipo' : 'este navegador');
  } catch (e) {
    chip('#chipNube', 'err', 'sin conexión');
    toast('No se pudo conectar con la nube: ' + e.message, 'error', 6000);
  }
  if (store.modo === 'local') await cargarMuestras();
  refrescarTodo();
}
async function cargarMuestras(forzar = false) {
  if (muestrasCargadas && !forzar) return;
  try { samples = await store.cargarMuestras(); muestrasCargadas = true; }
  catch (e) { toast('No se cargaron las muestras: ' + e.message, 'error'); }
  renderSenas(); renderTabla(); renderChecklist();
}
function puedeEscribir() {
  if (store.puedeEscribir()) return true;
  toast('Escribe la clave del equipo (pestaña Entrenar) para grabar o cambiar datos.', 'error', 4500);
  irA('entrenar'); $('#clave')?.focus();
  return false;
}

// ---------- Cámara (un solo elemento que se mueve entre vistas) ----------
const camEl = $('#tplCam').content.firstElementChild.cloneNode(true);
$('#slotCamVivo').append(camEl);
const video = $('#video'), canvas = $('#overlay'), ctx = canvas.getContext('2d');
let hands = null, pose = null, stream = null, running = false;
const frames = [], framesBase = [];
let lastPose = null, frameNo = 0, lastVideoTime = -1;
let fps = 0, fpsN = 0, fpsT = performance.now(), msInf = 0;
let ultimaMano = 0, ultimaPalabra = 0;

function moverCamara() {
  const slot = $(vista === 'entrenar' ? '#slotCamEntrenar' : '#slotCamVivo');
  if (camEl.parentElement !== slot) { slot.append(camEl); if (running) video.play().catch(() => {}); }
}

async function startCamera() {
  const btn = $('#btnCam'), est = $('#estadoCam');
  btn.disabled = true; chip('#chipCam', 'wait', 'cargando');
  try {
    nota(est, 'cargando modelo de manos…');
    const fs = await FilesetResolver.forVisionTasks(WASM);
    const opt = (path, delegate = 'GPU') => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO' });
    hands = await HandLandmarker.createFromOptions(fs, { ...opt(HAND_MODEL), numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 })
      .catch(() => HandLandmarker.createFromOptions(fs, { ...opt(HAND_MODEL, 'CPU'), numHands: 2 }));
    nota(est, 'cargando modelo del cuerpo…');
    pose = await PoseLandmarker.createFromOptions(fs, opt(POSE_MODEL))
      .catch(() => PoseLandmarker.createFromOptions(fs, opt(POSE_MODEL, 'CPU'))).catch(() => null);
    nota(est, 'esperando permiso de cámara…');
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    $('#camVacia').hidden = true;
    running = true;
    chip('#chipCam', 'on', 'cámara');
    requestAnimationFrame(loop);
    renderChecklist();
  } catch (e) {
    console.error(e);
    btn.disabled = false; chip('#chipCam', 'err', 'cámara');
    nota(est, location.protocol === 'file:' ? 'Abre la app con un servidor: la cámara no funciona desde file://' : (e.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : 'No se pudo iniciar: ' + (e.message || e)), 'error');
  }
}
$('#btnCam').onclick = startCamera;

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const now = performance.now();
  const t0 = performance.now();
  const hr = hands.detectForVideo(video, now);
  if (pose && (frameNo++ % 3 === 0 || !lastPose)) lastPose = pose.detectForVideo(video, now);
  const f = frameFeat(hr, lastPose);
  frames.push({ t: now, f });
  while (frames.length && frames[0].t < now - WIN_MS * 1.6) frames.shift();
  const fb = rasgosBase(hr, lastPose);
  framesBase.push({ t: now, f: fb.f, m: fb.manos });
  while (framesBase.length && framesBase[0].t < now - 1600) framesBase.shift();
  if (hasHand(f)) ultimaMano = now;
  draw(hr);
  if (vista === 'vivo' && !capturing) recognize(now);
  msInf = msInf * 0.9 + (performance.now() - t0) * 0.1;
  fpsN++;
  if (now - fpsT > 500) {
    fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now;
    const txt = `${fps.toFixed(0)} fps · ${msInf.toFixed(0)} ms`;
    $('#hudFps').textContent = txt; $('#hudFps2').textContent = txt;
  }
  // Enviar la frase sola al bajar las manos
  if (vista === 'vivo' && sentence.length && $('#autoEnviar').checked && now - ultimaMano > 2000 && now - ultimaPalabra > 2000) enviar();
}

function draw(hr) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  const W = canvas.width, H = canvas.height, k = W / 640;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = ctx.lineJoin = 'round';
  // Hombros y nariz (referencia del cuerpo)
  const p = lastPose?.landmarks?.[0];
  if (p) {
    ctx.strokeStyle = 'rgba(167,139,250,.55)'; ctx.lineWidth = 2 * k; ctx.setLineDash([6 * k, 6 * k]);
    ctx.beginPath(); ctx.moveTo(p[11].x * W, p[11].y * H); ctx.lineTo(p[12].x * W, p[12].y * H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(167,139,250,.9)';
    for (const i of [0, 11, 12]) { ctx.beginPath(); ctx.arc(p[i].x * W, p[i].y * H, 4 * k, 0, Math.PI * 2); ctx.fill(); }
  }
  for (const lm of hr.landmarks) {
    ctx.save();
    ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 14 * k;
    ctx.strokeStyle = 'rgba(34,211,238,.95)'; ctx.lineWidth = 3.2 * k;
    ctx.beginPath();
    for (const [a, b] of HAND_CONN) { ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); }
    ctx.stroke();
    ctx.restore();
    for (let j = 0; j < 21; j++) {
      const r = (j % 4 === 0 && j) ? 5 : 3.2;
      ctx.fillStyle = j % 4 === 0 && j ? '#a78bfa' : '#e6f1ff';
      ctx.beginPath(); ctx.arc(lm[j].x * W, lm[j].y * H, r * k, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function windowFrames(from, to) {
  const fr = frames.filter(x => x.t >= from && x.t <= to);
  if (fr.length < 5) return null;
  return { x: resample(fr), present: fr.filter(x => hasHand(x.f)).length / fr.length };
}

// ---------- Alumno: señas → palabras ----------
// Dos reconocedores: el modelo base de LSB (58 señas, siempre disponible) y el modelo del equipo (lo que graben).
const SOSTENER_MS = 320;
let stable = { key: null, t0: 0, n: 0 }, lastEmit = 0, sentence = [], bloqueada = null;
let umbral = Number(leerPref('umbral', 75)) / 100;
let ultimaBase = null, baseOcupado = false, ultimaConsultaBase = 0;

function nombreToken(tk) {
  if (tk.tipo === 'palabra') return tr(tk.texto);
  if (tk.tipo === 'letra') return 'letra ' + tk.texto.toUpperCase();
  if (tk.tipo === 'numero') return 'número ' + tk.texto;
  return 'espacio';
}
function consultarBase(now) {
  if (!baseLista() || baseOcupado || now - ultimaConsultaBase < 140) return;
  const fr = framesBase.filter(x => x.t >= now - 1500);
  if (fr.length < 8 || fr.filter(x => x.m).length / fr.length < 0.6) return;
  ultimaConsultaBase = now; baseOcupado = true;
  predecirBase(fr).then(r => { ultimaBase = { t: performance.now(), r }; }).catch(() => {}).finally(() => { baseOcupado = false; });
}
function candidatos(now) {
  const out = [];
  if (model) {
    const w = windowFrames(now - WIN_MS, now);
    if (w && w.present >= 0.6) for (const { label, p } of predict(model, w.x).slice(0, 3))
      out.push({ key: 'e:' + label, p, reposo: label === REPOSO, tk: { tipo: 'palabra', texto: label }, fuente: 'equipo' });
  }
  if (ultimaBase && now - ultimaBase.t < 450) for (const { clase, p } of ultimaBase.r.slice(0, 3))
    out.push({ key: 'b:' + clase, p, tk: aToken(clase), fuente: 'LSB' });
  return out.sort((a, b) => b.p - a.p);
}
function recognize(now) {
  consultarBase(now);
  const w = windowFrames(now - WIN_MS, now);
  if (!w) return;
  if (w.present < 0.6) { stable = { key: null, t0: 0, n: 0 }; bloqueada = null; showPred(null); return; }
  const cs = candidatos(now);
  showPred(cs);
  const top = cs[0];
  if (!top) return;
  // el modelo del equipo puede decir «no es una seña» con fuerza
  const reposo = cs.find(c => c.reposo);
  if (top.reposo || (reposo && reposo.p > 0.85)) { bloqueada = null; stable = { key: null, t0: 0, n: 0 }; return; }
  if (top.p < umbral) { stable = { key: null, t0: 0, n: 0 }; return; }
  if (bloqueada && top.key !== bloqueada) bloqueada = null;
  if (top.key === bloqueada) return;
  stable = stable.key === top.key ? { ...stable, n: stable.n + 1 } : { key: top.key, t0: now, n: 1 };
  if (now - stable.t0 >= SOSTENER_MS && stable.n >= 3 && now - lastEmit > 600) {
    lastEmit = now; bloqueada = top.key; stable = { key: null, t0: 0, n: 0 };
    frames.length = 0; framesBase.length = 0; ultimaBase = null;
    addToken(top.tk);
  }
}

let ultimaBarra = 0;
function showPred(cs) {
  const pred = $('#pred'), barras = $('#barras');
  if (!cs || !cs.length) {
    pred.hidden = true;
    barras.innerHTML = `<p class="vacio">${running ? (baseLista() || model ? '> esperando manos…' : '> cargando reconocedor…') : '> cámara apagada'}</p>`;
    return;
  }
  const top = cs[0];
  pred.hidden = !!top.reposo;
  $('#predTxt').textContent = nombreToken(top.tk);
  $('#predPct').textContent = `${(top.p * 100).toFixed(0)} % · ${top.fuente}`;
  $('#predAnillo').style.setProperty('--p', (top.p * 100).toFixed(0));
  const now = performance.now();
  if (now - ultimaBarra < 90) return;
  ultimaBarra = now;
  const vistos = new Set();
  barras.innerHTML = cs.filter(c => !vistos.has(nombreToken(c.tk)) && vistos.add(nombreToken(c.tk))).slice(0, 3).map(c =>
    `<div class="barra"><span class="n">${esc(c.reposo ? '· reposo ·' : nombreToken(c.tk))}</span><span class="b"><i style="width:${(c.p * 100).toFixed(0)}%"></i></span><span class="p">${(c.p * 100).toFixed(0)}%</span></div>`).join('');
}

// Las letras seguidas forman una palabra deletreada (S-E-R-G-I-O → «Sergio»).
function agrupar(tokens) {
  const out = [];
  for (const tk of tokens) {
    const ult = out[out.length - 1];
    if (tk.tipo === 'espacio') { if (ult) ult.cerrada = true; continue; }
    if ((tk.tipo === 'letra' || tk.tipo === 'numero') && ult && ult.tipo === tk.tipo && !ult.cerrada) { ult.texto += tk.texto; continue; }
    out.push({ ...tk });
  }
  return out.map(g => g.tipo === 'letra' ? { ...g, texto: g.texto.charAt(0).toUpperCase() + g.texto.slice(1) } : g);
}
const textoGrupo = g => g.tipo === 'palabra' ? tr(g.texto) : g.texto;
const fraseDe = tokens => agrupar(tokens).map(textoGrupo).join(' ');

function addToken(tk) {
  sentence.push(tk); ultimaPalabra = performance.now();
  renderSentence();
  const d = $('#destello'); d.textContent = tk.tipo === 'palabra' ? tr(tk.texto) : tk.tipo === 'espacio' ? '␣' : tk.texto.toUpperCase();
  d.classList.remove('on'); void d.offsetWidth; d.classList.add('on');
  if ($('#modoVoz').value === 'sena' && tk.tipo === 'palabra') speak(tr(tk.texto));
  if (navigator.vibrate) navigator.vibrate(30);
}
function renderSentence() {
  const f = $('#frase');
  f.dir = IDIOMAS[lang].rtl ? 'rtl' : 'ltr';
  const gs = agrupar(sentence);
  f.innerHTML = gs.length ? gs.map(g => `<span class="w ${g.tipo !== 'palabra' ? 'deletreo' : ''}" title="${esc(g.tipo === 'palabra' ? g.texto : 'deletreado')}">${esc(textoGrupo(g))}</span>`).join('') : '<span class="ph">Haz una seña frente a la cámara…</span>';
}
function enviar() {
  if (!sentence.length) return;
  const tokens = sentence.slice();
  sentence = []; renderSentence();
  addMsg({ quien: 'alumno', tokens });
  const modo = $('#modoVoz').value, n = agrupar(tokens).length, deletreo = tokens.some(t => t.tipo !== 'palabra');
  if (modo === 'frase' || (modo === 'sena' && (n > 1 || deletreo))) speak(fraseDe(tokens));
}
$('#btnEnviar').onclick = enviar;
$('#btnHablar').onclick = () => sentence.length && speak(fraseDe(sentence));
$('#btnDeshacer').onclick = () => { sentence.pop(); renderSentence(); };
$('#btnBorrar').onclick = () => { sentence = []; renderSentence(); };
$('#umbral').value = Math.round(umbral * 100);
$('#umbralTxt').textContent = Math.round(umbral * 100) + ' %';
$('#umbral').oninput = e => { umbral = e.target.value / 100; $('#umbralTxt').textContent = e.target.value + ' %'; guardarPref('umbral', e.target.value); };
$('#modoVoz').value = leerPref('modoVoz', 'sena');
$('#modoVoz').onchange = e => guardarPref('modoVoz', e.target.value);
$('#autoEnviar').checked = leerPref('autoEnviar', '1') === '1';
$('#autoEnviar').onchange = e => guardarPref('autoEnviar', e.target.checked ? '1' : '0');
function renderRapidas() { $('#rapidas').innerHTML = RAPIDAS.map(t => `<button data-w="${esc(t)}">${esc(tr(t))}</button>`).join(''); }
$('#rapidas').onclick = e => { const w = e.target.closest('button')?.dataset.w; if (w) { addMsg({ quien: 'alumno', tokens: [{ tipo: 'palabra', texto: w }] }); speak(tr(w)); } };

// ---------- Voz ----------
let voz = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  const es = vs.find(v => /es[-_](BO|419|MX|US|AR|CL|PE|CO)/i.test(v.lang)) || vs.find(v => /^es/i.test(v.lang)) || null;
  const code = IDIOMAS[lang].voz;
  voz = code ? (vs.find(v => v.lang.toLowerCase().startsWith(code)) || null) : es;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(t) {
  if (!('speechSynthesis' in window) || !t) return;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = voz?.lang || ({ en: 'en-US', he: 'he-IL' }[IDIOMAS[lang].voz] || 'es-ES');
  if (voz) u.voice = voz;
  u.rate = 0.95;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ---------- Conversación ----------
const chat = [];
function addMsg(m) {
  m.t = new Date(); m.idioma = lang;
  chat.push(m);
  $('#chatVacio').hidden = true;
  $('#chat').insertAdjacentHTML('beforeend', htmlMsg(m, chat.length - 1));
  const c = $('#chat'); c.scrollTop = c.scrollHeight;
}
function textoMsg(m) { return m.quien === 'alumno' ? fraseDe(m.tokens) : m.texto; }
function htmlMsg(m, i, anim = true) {
    const hora = m.t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const txt = textoMsg(m), rtl = m.quien === 'alumno' ? IDIOMAS[lang].rtl : IDIOMAS[m.idioma]?.rtl;
    const orig = m.quien === 'alumno' && lang !== 'es' ? `<div class="orig">${esc(agrupar(m.tokens).map(g => g.texto).join(' '))}</div>` : '';
    return `<li class="msg ${m.quien}${anim ? '' : ' quieto'}"><div class="quien">${m.quien === 'alumno' ? '<svg class="ic"><use href="#i-mano"/></svg>Alumno · señas' : '<svg class="ic"><use href="#i-mic"/></svg>Profesor · voz'}<time>${hora}</time><button class="repetir" data-i="${i}" title="${m.quien === 'alumno' ? 'Decir otra vez' : 'Repetir en señas'}" aria-label="Repetir"><svg class="ic"><use href="#i-repetir"/></svg></button></div><div class="txt" dir="${rtl ? 'rtl' : 'ltr'}">${esc(txt)}</div>${orig}</li>`;
}
function renderChat() {
  $('#chatVacio').hidden = chat.length > 0;
  $('#chat').innerHTML = chat.map((m, i) => htmlMsg(m, i, false)).join('');
  const c = $('#chat'); c.scrollTop = c.scrollHeight;
}
$('#chat').onclick = e => {
  const i = e.target.closest('.repetir')?.dataset.i; if (i == null) return;
  const m = chat[i];
  if (m.quien === 'alumno') speak(textoMsg(m)); else showSigns(m.texto, false);
};
$('#btnLimpiarChat').onclick = () => { chat.length = 0; renderChat(); };

// ---------- Profesor: voz → señas ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, escuchando = false;
const clipCache = new Map();
if (!SR) { $('#btnEscuchar').classList.add('no-disponible'); nota($('#estadoVoz'), 'Para hablar usa Chrome o Edge. Aquí puedes escribir la frase.'); }

function pararMic() { escuchando = false; try { rec?.stop(); } catch {} $('#btnEscuchar').setAttribute('aria-pressed', 'false'); nota($('#estadoVoz'), ''); }
function toggleMic() {
  if (!SR) return toast('Este navegador no reconoce voz. Usa Chrome o Edge, o escribe la frase.', 'error', 4500);
  if (escuchando) return pararMic();
  rec = new SR();
  rec.lang = IDIOMAS[lang].sr || 'es-BO'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) { if (t) { addMsg({ quien: 'profesor', texto: t }); showSigns(t); } }
      else interim += t + ' ';
    }
    $('#subtitulo').innerHTML = interim ? `<span class="interino">${esc(interim)}</span>` : $('#subtitulo').innerHTML;
  };
  rec.onerror = e => { if (e.error !== 'no-speech') { nota($('#estadoVoz'), 'Micrófono: ' + e.error, 'error'); if (e.error === 'not-allowed') pararMic(); } };
  rec.onend = () => { if (escuchando) { try { rec.start(); } catch {} } };
  try { rec.start(); } catch (e) { return toast('No se pudo usar el micrófono: ' + e.message, 'error'); }
  escuchando = true;
  $('#btnEscuchar').setAttribute('aria-pressed', 'true');
  nota($('#estadoVoz'), `Escuchando en ${IDIOMAS[lang].sr ? IDIOMAS[lang].nombre : 'castellano'}…`, 'ok');
}
$('#btnEscuchar').onclick = toggleMic;
$('#formTexto').onsubmit = e => {
  e.preventDefault();
  const t = $('#textoManual').value.trim(); if (!t) return;
  addMsg({ quien: 'profesor', texto: t });
  showSigns(t); $('#textoManual').value = '';
};

const avatar = new Avatar($('#avatar'));
$('#avisoAvatar').onclick = e => { const v = e.target.closest('[data-ir]')?.dataset.ir; if (v) irA(v); };
const pendientes = [];
let fichaBase = 0, actuales = [], idxSena = 0;
const tieneSena = l => !!(model?.protos?.[l]);
const ABC = 'abcdefghijklmnñopqrstuvwxyz'.split('');
// Deletreo (dactilología LSB): letras grabadas por el equipo si existen; si no, las del abecedario incorporado.
function senasDeletreo(palabra, i) {
  const ls = letrasDe(palabra);
  if (!ls.length) return null;
  const out = [];
  for (const L of ls) {
    const propia = model?.protos?.[L.toLowerCase()];
    const proto = propia || protoLetra(L);
    if (!proto) return null;
    out.push({ label: L, proto, i, letra: true, palabra, dur: 560, gap: 110 });
  }
  return out;
}
function avisoAvatar(txt, conBoton = false) {
  const a = $('#avisoAvatar');
  a.hidden = !txt;
  if (txt) a.innerHTML = `<p>${esc(txt)}</p>${conBoton ? '<button class="btn chico" data-ir="entrenar">Ir a Entrenar</button>' : ''}`;
}
function showSigns(text, conSubtitulo = true) {
  const m = matchSigns(text, vocab.filter(v => v.length > 1), alias(lang));   // las letras sueltas solo sirven para deletrear
  if (conSubtitulo) $('#subtitulo').textContent = text;
  const base = fichaBase; fichaBase += m.length;
  const items = m.map((x, i) => {
    const conSena = x.label && tieneSena(x.label);
    return { ...x, i: base + i, conSena, letras: conSena ? null : senasDeletreo(x.text, base + i) };
  });
  $('#fichas').innerHTML = (pendientes.length || avatar.tl ? $('#fichas').innerHTML : '') + items.map(x => {
    const cls = x.conSena ? 'si' : x.letras ? 'si deletreo' : '';
    const tit = x.conSena ? 'seña' : x.letras ? 'deletreada en dactilología' : 'sin seña';
    return `<span class="ficha ${cls}" data-i="${x.i}" title="${tit}">${esc(x.text)}</span>`;
  }).join('');
  const signs = [];
  for (const x of items) {
    if (x.conSena) signs.push({ label: x.label, proto: model.protos[x.label], i: x.i });
    else if (x.letras) signs.push(...x.letras);
  }
  if (!signs.length) { $('#hudAvatar').textContent = 'nada que señar'; return; }
  avisoAvatar('');
  pendientes.push(signs);
  if (!avatar.tl) siguiente();
}
function siguiente() {
  const lote = pendientes.shift();
  if (!lote) { $('#clipLabel').textContent = ''; $('#hudAvatar').textContent = 'avatar listo'; return; }
  actuales = lote; idxSena = 0;
  avatar.play(lote);
}
avatar.onSign = (label, item) => {
  $$('.ficha.ahora').forEach(f => f.classList.remove('ahora'));
  if (!label) { $('#clipLabel').textContent = ''; mostrarVideo(null); return; }
  idxSena = actuales.indexOf(item) + 1;
  if (item) $(`.ficha[data-i="${item.i}"]`)?.classList.add('ahora');
  if (item?.letra) {
    const ls = letrasDe(item.palabra), k = actuales.filter(a => a.i === item.i).indexOf(item);
    $('#clipLabel').innerHTML = ls.map((l, j) => j === k ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`).join('');
    $('#clipLabel').classList.add('deletreo');
  } else { $('#clipLabel').textContent = tr(label); $('#clipLabel').classList.remove('deletreo'); }
  $('#hudAvatar').textContent = `${idxSena}/${actuales.length}`;
  mostrarVideo(item?.letra ? null : label);
};
avatar.onEnd = () => setTimeout(siguiente, 120);
async function mostrarVideo(label) {
  const clip = $('#clip');
  if (!label || !clips.has(label) || !$('#conVideoReal').checked) { clip.hidden = true; clip.pause(); return; }
  const blob = clipCache.get(label) || await store.cargarVideo(label).catch(() => null);
  if (!blob) return;
  clipCache.set(label, blob);
  if (clip.src) URL.revokeObjectURL(clip.src);
  clip.src = URL.createObjectURL(blob); clip.hidden = false;
  clip.play().catch(() => {});
}

// ---------- Entrenar ----------
let capturing = false;
async function countdown(n) {
  const c = $('#cuenta'); c.hidden = false;
  for (let i = n; i > 0; i--) { c.textContent = i; await sleep(650); }
  c.hidden = true;
}
function needCam() {
  if (running) return true;
  toast('Primero enciende la cámara.', 'error');
  return false;
}
function busy(b) { ['#btnUna', '#btnDiez', '#btnVideo', '#btnBorrarSena', '#btnEntrenar'].forEach(s => $(s).disabled = b); }

async function grabar(n) {
  if (!needCam() || !puedeEscribir()) return;
  await cargarMuestras();
  busy(true); capturing = true;
  let ok = 0;
  const nuevas = [], est = $('#estadoGrab');
  try {
    for (let k = 0; k < n; k++) {
      nota(est, `«${selected}» · muestra ${k + 1} de ${n} · prepárate…`);
      await countdown(k === 0 ? 3 : 2);
      $('#rec').hidden = false;
      const t0 = performance.now();
      await sleep(WIN_MS + 60);
      $('#rec').hidden = true;
      const w = windowFrames(t0, t0 + WIN_MS + 60);
      if (!w) { nota(est, 'La cámara va lenta: muestra no guardada.', 'error'); await sleep(800); continue; }
      if (selected !== REPOSO && w.present < 0.5) { nota(est, 'No vi las manos: muestra no guardada.', 'error'); await sleep(800); continue; }
      const s = { label: selected, x: w.x };
      samples.push(s); nuevas.push(s); ok++;
      renderSenas(); renderSel();
      await sleep(200);
    }
    if (nuevas.length) { nota(est, 'guardando…'); await store.agregarMuestras(nuevas); modeloViejo = true; }
    nota(est, `✓ ${ok} muestra(s) de «${selected}»${store.modo === 'nube' ? ' en la nube' : ''}.`, 'ok');
  } catch (e) {
    samples = samples.filter(s => !nuevas.includes(s));
    nota(est, 'No se guardó: ' + e.message, 'error');
  } finally {
    capturing = false; busy(false); $('#cuenta').hidden = true; $('#rec').hidden = true;
    renderSenas(); renderSel(); renderTabla(); renderChecklist();
  }
}
$('#btnUna').onclick = () => grabar(1);
$('#btnDiez').onclick = () => grabar(10);

$('#btnVideo').onclick = async () => {
  if (!needCam() || !puedeEscribir()) return;
  if (selected === REPOSO) return toast('«reposo» no necesita video.');
  if (!window.MediaRecorder) return toast('Este navegador no puede grabar video.', 'error');
  const est = $('#estadoGrab');
  busy(true);
  try {
    nota(est, `Video de «${selected}»: haz la seña clara, una vez.`);
    await countdown(3);
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 1_200_000 } : undefined);
    const parts = []; mr.ondataavailable = e => e.data.size && parts.push(e.data);
    const done = new Promise(r => mr.onstop = r);
    $('#rec').hidden = false; mr.start(); await sleep(2200); mr.stop(); await done; $('#rec').hidden = true;
    const blob = new Blob(parts, { type: mr.mimeType || 'video/webm' });
    nota(est, 'subiendo video…');
    await store.guardarVideo(selected, blob);
    clips.add(selected); clipCache.set(selected, blob);
    nota(est, `✓ Video de «${selected}» guardado.`, 'ok');
  } catch (e) { nota(est, 'No se pudo grabar: ' + e.message, 'error'); }
  finally { busy(false); $('#rec').hidden = true; renderSenas(); renderTabla(); renderChecklist(); }
};

$('#btnBorrarSena').onclick = async () => {
  if (!puedeEscribir()) return;
  await cargarMuestras();
  const n = count(selected);
  if (!n) return toast(`«${selected}» no tiene muestras.`);
  if (!confirm(`¿Borrar las ${n} muestras de «${selected}» para todo el equipo?`)) return;
  try {
    await store.borrarMuestras(selected);
    samples = samples.filter(s => s.label !== selected); modeloViejo = true;
    toast(`Muestras de «${selected}» borradas.`);
  } catch (e) { toast(e.message, 'error'); }
  renderSenas(); renderSel(); renderTabla(); renderChecklist();
};

const curva = { loss: [], acc: [], vacc: [] };
function dibujarCurva() {
  const c = $('#curva'), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!r.width) return;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  const W = r.width, H = r.height, P = 10, TOP = 26;
  x.strokeStyle = 'rgba(125,211,252,.1)'; x.lineWidth = 1;
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, H * i / 4); x.lineTo(W, H * i / 4); x.stroke(); }
  const n = curva.loss.length;
  if (!n) { x.fillStyle = '#5d7189'; x.font = '12px "JetBrains Mono", monospace'; x.fillText('la curva aparece al entrenar', P, H / 2 + 4); return; }
  const maxL = Math.max(...curva.loss, 0.01);
  const linea = (arr, max, color) => {
    x.strokeStyle = color; x.lineWidth = 2; x.shadowColor = color; x.shadowBlur = 8;
    x.beginPath();
    arr.forEach((v, i) => { if (v == null) return; const px = P + (W - 2 * P) * (n === 1 ? 0 : i / (n - 1)), py = H - P - (H - P - TOP) * (v / max); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke(); x.shadowBlur = 0;
  };
  linea(curva.loss, maxL, '#f472b6');
  linea(curva.acc, 1, '#22d3ee');
  if (curva.vacc.some(v => v != null)) linea(curva.vacc, 1, '#34d399');
  x.font = '11px "JetBrains Mono", monospace';
  [['error', '#f472b6'], ['acierto', '#22d3ee'], ['muestras nuevas', '#34d399']].forEach(([t, col], i) => { x.fillStyle = col; x.fillText('● ' + t, P + i * 96, 16); });
}

$('#btnEntrenar').onclick = async () => {
  const est = $('#estadoModelo'), bar = $('#progreso');
  if (!puedeEscribir()) return;
  nota(est, 'bajando todas las muestras del equipo…');
  await cargarMuestras(true);
  if (count(REPOSO) < 3) return nota(est, 'Graba primero al menos 3 muestras de «reposo» (sin hacer señas).', 'error');
  busy(true);
  curva.loss = []; curva.acc = []; curva.vacc = [];
  const t0 = performance.now();
  try {
    const m = await train(samples, vocab, s => {
      bar.style.width = (s.ep / s.epochs * 100) + '%';
      curva.loss.push(s.loss); curva.acc.push(s.acc); curva.vacc.push(s.vacc);
      dibujarCurva();
      nota(est, `entrenando… época ${s.ep}/${s.epochs} · acierto ${(s.acc * 100).toFixed(0)} %` + (s.vacc != null ? ` · en muestras nuevas ${(s.vacc * 100).toFixed(0)} %` : ''));
    });
    nota(est, 'publicando el modelo…');
    await store.guardarModelo(m);
    model = m; modeloViejo = false;
    nota(est, `✓ Entrenado en ${((performance.now() - t0) / 1000).toFixed(1)} s${store.modo === 'nube' ? ' y publicado para todos los que abren el link' : ''}.`, 'ok');
    toast('Modelo listo. Prueba en «En vivo».', 'ok');
  } catch (e) { nota(est, e.message, 'error'); bar.style.width = '0'; }
  finally { busy(false); refrescarTodo(); }
};

function renderModelo() {
  const s = model?.stats || {};
  const n = model ? model.labels.filter(l => l !== REPOSO).length : 0;
  chip('#chipModelo', model ? (modeloViejo ? 'wait' : 'on') : 'off', model ? `equipo: ${n} señas${s.vacc != null ? ' · ' + Math.round(s.vacc * 100) + ' %' : ''}` : 'equipo: sin modelo');
  $('#mAcc').textContent = s.vacc != null ? Math.round(s.vacc * 100) + '%' : (model ? Math.round((s.acc || 0) * 100) + '%' : '—');
  $('#mSenas').textContent = model ? n : '—';
  $('#mMuestras').textContent = model ? s.n : '—';
  const ps = s.porSena;
  $('#porSena').innerHTML = ps ? Object.entries(ps).filter(([l]) => l !== REPOSO).sort((a, b) => (a[1].acc ?? 1) - (b[1].acc ?? 1)).map(([l, v]) => {
    const a = v.acc ?? 0, cls = a >= .85 ? '' : a >= .6 ? 'flojo' : 'malo';
    return `<div class="ps ${cls}" title="${v.n} muestras"><span>${esc(l)}</span><span class="b"><i style="width:${(a * 100).toFixed(0)}%"></i></span><span class="p">${v.acc == null ? '—' : Math.round(a * 100) + '%'}</span></div>`;
  }).join('') : '<p class="nota">Entrena para ver qué señas reconoce mejor.</p>';
  if (!curva.loss.length && s.ep) { /* sin curva guardada */ }
  renderComo();
}

function renderChecklist() {
  const senasListas = vocab.filter(v => v !== REPOSO && count(v) >= MINIMO).length;
  const items = [
    [baseLista(), 'Reconocedor LSB base (58 señas reales) cargado'],
    [running, 'Cámara encendida'],
    ...(store.modo === 'nube' ? [[claveOk, 'Clave del equipo (para grabar en la nube)']] : []),
    [count(REPOSO) >= MINIMO, `«reposo» con ${MINIMO}+ muestras (${count(REPOSO)})`],
    [senasListas >= 5, `Señas propias del equipo: 5 o más con ${MINIMO}+ muestras (${senasListas}) (opcional)`],
    [!!model && !modeloViejo, 'Modelo entrenado con las muestras actuales'],
    [(model?.stats?.vacc ?? 0) >= 0.85, 'Acierto de 85 % o más en muestras nuevas'],
    [clips.size >= Math.min(5, senasListas || 5), `Videos de referencia (opcional): ${clips.size}`],
  ];
  $('#checklist').innerHTML = items.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${esc(t)}</li>`).join('');
}

function renderSenas() {
  const total = vocab.reduce((n, v) => n + count(v), 0);
  $('#totalMuestras').textContent = `${total} muestras`;
  $('#senas').innerHTML = vocab.map(v => {
    const n = count(v), p = Math.min(100, n / META * 100);
    return `<button class="sena ${v === REPOSO ? 'reposo' : ''}" role="option" data-v="${esc(v)}" aria-selected="${v === selected}"><span class="anillo ${n >= MINIMO ? 'listo' : ''}" style="--p:${p.toFixed(0)}"></span><span class="nm">${esc(v)}</span>${clips.has(v) ? '<span class="vid" title="tiene video"></span>' : ''}<span class="ct">${n}</span></button>`;
  }).join('');
}
function renderSel() {
  const n = count(selected);
  $('#selNombre').textContent = selected;
  $('#selTrad').textContent = selected === REPOSO ? 'sin seña' : ['en', 'he', 'qu', 'ay', 'gn'].map(l => TRAD[selected]?.[l]).filter(Boolean).join(' · ');
  $('#selCuenta').textContent = n;
  const a = $('#selAnillo'); a.style.setProperty('--p', Math.min(100, n / META * 100).toFixed(0)); a.classList.toggle('listo', n >= MINIMO);
  $('#selConsejo').textContent = selected === REPOSO
    ? 'Manos quietas, abajo, acomodándote o rascándote: así la app aprende cuándo NO hay seña.'
    : n >= META ? '✓ Suficientes muestras. Más variedad (otra persona, otra luz) mejora el modelo.'
    : `Faltan ${META - n} muestras. Varía un poco la distancia y la posición.`;
}
$('#senas').onclick = e => {
  const b = e.target.closest('.sena'); if (!b) return;
  selected = b.dataset.v; renderSenas(); renderSel(); nota($('#estadoGrab'), '');
};

// ---------- Datos ----------
function renderTabla() {
  const cols = ['en', 'he', 'qu', 'ay', 'gn'];
  $('#tablaVocab').innerHTML = `<thead><tr><th>Seña</th><th>Muestras</th><th>Video</th>${cols.map(c => `<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>` +
    vocab.map(v => `<tr><td>${esc(v)}</td><td class="num">${count(v)}</td><td>${clips.has(v) ? '<svg class="ic"><use href="#i-video"/></svg>' : ''}</td>${cols.map(c => `<td>${esc(v === REPOSO ? '' : (TRAD[v]?.[c] || '—'))}</td>`).join('')}<td>${v === REPOSO ? '' : `<button class="quitar" data-del="${esc(v)}" aria-label="Quitar ${esc(v)}">✕</button>`}</td></tr>`).join('') + '</tbody>';
}
$('#tablaVocab').onclick = async e => {
  const v = e.target.closest('.quitar')?.dataset.del; if (!v) return;
  if (!puedeEscribir() || !confirm(`¿Quitar «${v}» con sus muestras y su video, para todo el equipo?`)) return;
  try {
    const nuevo = vocab.filter(x => x !== v);
    await store.borrarMuestras(v);
    if (clips.has(v)) await store.borrarVideo(v);
    await store.guardarVocab(nuevo);
    vocab = nuevo; samples = samples.filter(s => s.label !== v); clips.delete(v); modeloViejo = true;
    if (selected === v) selected = REPOSO;
    toast(`«${v}» quitada.`);
  } catch (err) { toast(err.message, 'error'); }
  refrescarTodo();
};
$('#formSena').onsubmit = async e => {
  e.preventDefault();
  const v = $('#nuevaSena').value.trim().toLowerCase(); if (!v || !puedeEscribir()) return;
  try {
    if (!vocab.includes(v)) { await store.guardarVocab([...vocab, v]); vocab.push(v); }
    $('#nuevaSena').value = ''; selected = v;
    toast(`«${v}» agregada. Grábala en «Entrenar».`, 'ok');
  } catch (err) { toast(err.message, 'error'); }
  refrescarTodo();
};

$('#btnAbecedario').onclick = async () => {
  if (!puedeEscribir()) return;
  const nuevas = ABC.filter(l => !vocab.includes(l));
  if (!nuevas.length) return toast('El abecedario ya está en el vocabulario.');
  try { await store.guardarVocab([...vocab, ...nuevas]); vocab.push(...nuevas); toast(`Agregadas ${nuevas.length} letras. Grábalas en «Entrenar» para deletrear nombres.`, 'ok', 4500); }
  catch (err) { toast(err.message, 'error'); }
  refrescarTodo();
};

const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$('#btnExportar').onclick = async () => {
  await cargarMuestras();
  const out = { app: 'manos-que-hablan', v: 2, D, vocab, samples: samples.map(s => ({ l: s.label, x: f32ToB64(s.x) })), clips: {} };
  if ($('#conVideos').checked) for (const c of clips) { const b = await store.cargarVideo(c).catch(() => null); if (b) out.clips[c] = await blobToData(b); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `senas-lsb-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  nota($('#estadoDatos'), `✓ Exportadas ${samples.length} muestras y ${Object.keys(out.clips).length} videos.`, 'ok');
};
$('#archivo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  if (!puedeEscribir()) return;
  const est = $('#estadoDatos');
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'manos-que-hablan' || d.D !== D) throw new Error('el archivo no es de esta app o es de otra versión');
    await cargarMuestras();
    nota(est, 'subiendo…');
    const nuevoVocab = [...vocab, ...(d.vocab || []).filter(v => !vocab.includes(v))];
    await store.guardarVocab(nuevoVocab); vocab = nuevoVocab;
    const nuevas = (d.samples || []).map(s => ({ label: s.l, x: typeof s.x === 'string' ? b64ToF32(s.x) : Float32Array.from(s.x) }));
    await store.agregarMuestras(nuevas); samples.push(...nuevas);
    let nc = 0;
    for (const [c, url] of Object.entries(d.clips || {})) { await store.guardarVideo(c, await (await fetch(url)).blob()); clips.add(c); nc++; }
    modeloViejo = true;
    nota(est, `✓ Sumadas ${nuevas.length} muestras y ${nc} videos. Vuelve a entrenar el modelo.`, 'ok');
  } catch (err) { nota(est, 'No se pudo importar: ' + err.message, 'error'); }
  refrescarTodo();
};
$('#btnReset').onclick = async () => {
  if (!puedeEscribir()) return;
  if (!confirm('¿Borrar TODAS las muestras, videos y el modelo, para todo el equipo? Exporta antes si quieres conservarlos.')) return;
  try { await store.borrarTodo(); } catch (err) { return toast(err.message, 'error'); }
  vocab = DEFAULT_VOCAB.slice(); samples = []; model = null; clips = new Set(); clipCache.clear(); modeloViejo = false;
  selected = vocab[1];
  nota($('#estadoDatos'), 'Todo borrado.');
  refrescarTodo();
};

// ---------- Cómo funciona ----------
function renderComo() {
  const s = model?.stats || {};
  const datos = [
    [(baseLista() ? 58 : 0) + (model ? model.labels.filter(l => l !== REPOSO).length : 0), 'señas que reconoce'],
    [39, 'letras y números que el avatar deletrea'],
    [s.vacc != null ? Math.round(s.vacc * 100) + '%' : '—', 'acierto de las señas del equipo'],
    [running ? Math.round(msInf) + ' ms' : '—', 'por cuadro (cámara + IA)'],
    [Object.keys(IDIOMAS).length, 'idiomas de salida'],
  ];
  $('#metricasComo').innerHTML = datos.map(([v, t]) => `<div><span class="mono">${esc(v)}</span><small>${esc(t)}</small></div>`).join('');
}

// ---------- Navegación ----------
function irA(v) {
  vista = v;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  $$('[data-vista]').forEach(s => s.hidden = s.dataset.vista !== v);
  moverCamara();
  showPred(null);
  if (v === 'entrenar' || v === 'datos') cargarMuestras();
  if (v === 'entrenar') requestAnimationFrame(dibujarCurva);
  if (v === 'como') renderComo();
  guardarPref('vista', v);
}
$('.tabs').onclick = e => { const b = e.target.closest('button'); if (b) irA(b.dataset.view); };

// ---------- Idioma ----------
const sel = $('#idioma');
sel.innerHTML = Object.entries(IDIOMAS).map(([k, v]) => `<option value="${k}">${esc(v.nombre)}${v.validar ? ' · borrador' : ''}</option>`).join('');
sel.value = lang;
sel.onchange = () => {
  lang = sel.value; guardarPref('idioma', lang);
  pickVoice(); renderSentence(); renderRapidas(); renderChat();
  if (escuchando) pararMic();
  if (IDIOMAS[lang].validar) toast(`${IDIOMAS[lang].nombre}: traducción en borrador, valídala con un hablante. Se lee con voz en castellano.`, '', 5000);
  else if (lang !== 'es' && 'speechSynthesis' in window && speechSynthesis.getVoices().length && !voz) toast('Este equipo no tiene voz instalada en ese idioma.', 'error');
};

// ---------- Clave del equipo ----------
let claveOk = false;
$('#zonaClave').hidden = store.modo !== 'nube';
async function probarClave() {
  if (store.modo !== 'nube') return;
  if (!store.clave()) { claveOk = false; chip('#chipClave', 'off', 'sin clave'); renderChecklist(); return; }
  chip('#chipClave', 'wait', 'probando');
  try { claveOk = !!(await store.probarClave()); chip('#chipClave', claveOk ? 'on' : 'err', claveOk ? 'clave correcta' : 'clave incorrecta'); }
  catch (e) { claveOk = false; chip('#chipClave', 'err', 'error'); }
  renderChecklist();
}
if (store.modo === 'nube') {
  $('#clave').value = store.clave();
  $('#formClave').onsubmit = async e => { e.preventDefault(); store.setClave($('#clave').value); await probarClave(); toast(claveOk ? 'Clave correcta: ya puedes grabar y entrenar.' : 'Clave incorrecta.', claveOk ? 'ok' : 'error'); };
  probarClave();
}

// ---------- Teclado y pantalla completa ----------
function pantallaCompleta() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('#btnPantalla').onclick = pantallaCompleta;
addEventListener('keydown', e => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (vista === 'vivo' && e.code === 'Space') { e.preventDefault(); $('#btnHablar').click(); }
  else if (vista === 'vivo' && e.key === 'Enter') { e.preventDefault(); enviar(); }
  else if (vista === 'vivo' && e.key === 'Backspace') { e.preventDefault(); $('#btnDeshacer').click(); }
  else if (e.key === 'm' || e.key === 'M') toggleMic();
  else if (e.key === 'f' || e.key === 'F') pantallaCompleta();
});

// ---------- Arranque ----------
function refrescarTodo() {
  renderSenas(); renderSel(); renderTabla(); renderModelo(); renderChecklist(); renderComo(); showPred(null);
}
renderRapidas(); renderSentence(); renderChat(); refrescarTodo(); dibujarCurva();
irA(['vivo', 'entrenar', 'datos', 'como'].includes(leerPref('vista', 'vivo')) ? leerPref('vista', 'vivo') : 'vivo');
cargarTodo();
cargarFormas();
async function iniciarLsb(intentos = 3) {
  chip('#chipLsb', 'wait', 'LSB…');
  for (let k = 1; k <= intentos; k++) {
    try {
      await cargarModeloBase();
      chip('#chipLsb', 'on', '58 señas LSB'); showPred(null); renderComo(); renderChecklist();
      return;
    } catch (e) { console.warn('LSB intento', k, e?.message || e); await sleep(1500 * k); }
  }
  chip('#chipLsb', 'err', 'LSB: reintentar');
}
$('#chipLsb').style.cursor = 'pointer';
$('#chipLsb').onclick = () => !baseLista() && iniciarLsb();
iniciarLsb();
addEventListener('resize', () => vista === 'entrenar' && dibujarCurva());

// Funciona sin internet después de la primera carga
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
