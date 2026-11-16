#!/usr/bin/env python3
"""Genera n8n/manos-puente.json (workflow importable en n8n). Correr: python3 n8n/generar.py"""
import json, uuid, pathlib

N, C = [], {}          # nodos y conexiones
def nodo(nombre, tipo, ver, pos, params, **extra):
    N.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, nombre)), "name": nombre, "type": tipo,
              "typeVersion": ver, "position": pos, "parameters": params, **extra})
    return nombre
def code(nombre, pos, js):
    """Code node por ítem: $json es el ítem actual; devuelve { json }."""
    js = js.replace("return [{ json:", "return { json:").rstrip()
    if js.endswith("}];"): js = js[:-3] + "};"
    return nodo(nombre, "n8n-nodes-base.code", 2, pos, {"mode": "runOnceForEachItem", "jsCode": js.strip()})
def une(a, b, salida=0):
    C.setdefault(a, {"main": []})
    m = C[a]["main"]
    while len(m) <= salida: m.append([])
    m[salida].append({"node": b, "type": "main", "index": 0})

TG = {"telegramApi": {"id": "", "name": "Bot de Manos que hablan"}}
SIGUE = {"onError": "continueRegularOutput"}

CLAVES = r"""// ⚠️ Llená estas tres claves (las mismas en los dos nodos «Claves»).
const cfg = {
  SUPA_URL: 'https://TU-PROYECTO.supabase.co',
  SUPA_KEY: 'TU_SERVICE_ROLE_KEY',          // Supabase → Settings → API → service_role (secreta)
  ANTHROPIC_KEY: 'sk-ant-...',              // console.anthropic.com
  GROQ_KEY: 'gsk_...',                      // console.groq.com (Whisper gratis, para los audios)
};
return $input.all().map(i => ({ json: { ...(i.json.body ?? i.json), cfg } }));"""

# Ayudante para Code nodes que hablan con Supabase
SB = r"""const { cfg } = $json;
const sb = (metodo, ruta, body, prefer = 'return=representation') => this.helpers.httpRequest({
  method: metodo, url: `${cfg.SUPA_URL}/rest/v1/${ruta}`, body, json: true,
  headers: { apikey: cfg.SUPA_KEY, Authorization: `Bearer ${cfg.SUPA_KEY}`, Prefer: prefer },
});
"""

def ia(nombre, pos, sistema, usuario, esquema=None):
    """HTTP Request a la API de Claude."""
    cuerpo = ("={{ JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 1024, "
              "output_config: { effort: 'low'" + (", format: { type: 'json_schema', schema: " + json.dumps(esquema) + " }" if esquema else "") + " }, "
              "fallbacks: 'default', system: " + json.dumps(sistema, ensure_ascii=False) + ", "
              "messages: [{ role: 'user', content: " + usuario + " }] }) }}")
    return nodo(nombre, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "method": "POST", "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": True, "headerParameters": {"parameters": [
            {"name": "x-api-key", "value": "={{ $json.cfg.ANTHROPIC_KEY }}"},
            {"name": "anthropic-version", "value": "2023-06-01"},
            {"name": "anthropic-beta", "value": "server-side-fallback-2026-07-01"}]},
        "sendBody": True, "specifyBody": "json", "jsonBody": cuerpo, "options": {"timeout": 30000}})

LEER_IA = r"""// Saca el texto de la respuesta de Claude (o cae a algo seguro si se negó o falló).
const r = $json, prev = $('%s').item.json;
const texto = r.stop_reason === 'refusal' ? '' : (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
return [{ json: { ...prev, ia: texto } }];"""

def si(nombre, pos, expr):
    return nodo(nombre, "n8n-nodes-base.if", 2, pos, {"conditions": {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
        "conditions": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, nombre + "c")), "leftValue": expr, "rightValue": "",
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
        "combinator": "and"}, "options": {}})

def switch(nombre, pos, expr, casos, op="equals"):
    return nodo(nombre, "n8n-nodes-base.switch", 3.2, pos, {"rules": {"values": [
        {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
                        "conditions": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, nombre + k)), "leftValue": e or expr, "rightValue": v,
                                        "operator": {"type": "string", "operation": o or op} | ({"singleValue": True} if o == "exists" else {})}],
                        "combinator": "and"}, "renameOutput": True, "outputKey": k}
        for k, v, e, o in casos]}, "options": {}})

def responder(nombre, pos, expr):
    return nodo(nombre, "n8n-nodes-base.respondToWebhook", 1.1, pos, {"respondWith": "json", "responseBody": expr, "options": {}})

def tg(nombre, pos, chat, texto, **kw):
    return nodo(nombre, "n8n-nodes-base.telegram", 1.2, pos, {"chatId": chat, "text": texto,
                "additionalFields": {"appendAttribution": False}}, credentials=TG, **kw)

# =================== 1) La página llama a n8n ===================
wh = nodo("Página → n8n", "n8n-nodes-base.webhook", 2, [0, 300], {
    "httpMethod": "POST", "path": "manos", "responseMode": "responseNode", "options": {"allowedOrigins": "*"}},
    webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "manos-webhook")))
k1 = nodo("Claves", "n8n-nodes-base.code", 2, [220, 300], {"jsCode": CLAVES})
sw = switch("¿Qué pide la página?", [440, 300], "={{ $json.accion }}",
            [(a, a, None, None) for a in ["sala", "frase", "enviar", "emergencia", "resumen"]])
une(wh, k1); une(k1, sw)

# -- sala: crearla si no existe
s1 = code("Supabase: abrir sala", [700, -40], SB + r"""
await sb('POST', 'salas?on_conflict=codigo', { codigo: $json.sala }, 'resolution=ignore-duplicates,return=minimal');
const [s] = await sb('GET', `salas?codigo=eq.${$json.sala}&select=chat_id,nombre`);
return [{ json: { ok: true, vinculada: !!s?.chat_id, nombre: s?.nombre ?? null } }];""")
r1 = responder("Responder sala", [920, -40], "={{ JSON.stringify($json) }}")
une(sw, s1, 0); une(s1, r1)

# -- frase: señas sueltas → frase natural
f1 = ia("IA: señas → frase", [700, 140],
        "Eres intérprete de Lengua de Señas Boliviana (LSB). Recibes glosas: palabras sueltas en el orden en que se hicieron las señas, "
        "sin artículos ni conjugación, a veces deletreadas letra por letra. Devuelve UNA sola frase natural en el idioma pedido, en primera persona, "
        "corta, sin inventar datos que no estén en las glosas. Solo la frase, sin comillas ni explicaciones.",
        "`Idioma: ${$json.idioma || 'es'}\\nGlosas: ${($json.glosas || []).join(' ')}`")
f2 = code("Leer frase", [920, 140], LEER_IA % "Claves" + "\n")
# (el return de LEER_IA ya devuelve; el responder arma la frase con respaldo)
r2 = responder("Responder frase", [1140, 140], "={{ JSON.stringify({ frase: $json.ia || ($json.glosas || []).join(' ') }) }}")
une(sw, f1, 1); une(f1, f2); une(f2, r2)

# -- enviar: guardar + Telegram (texto y voz)
e1 = code("Supabase: guardar y buscar contacto", [700, 320], SB + r"""
await sb('POST', 'mensajes', { sala: $json.sala, dir: 'ida', texto: $json.frase, glosas: $json.glosas || [] }, 'return=minimal');
const [s] = await sb('GET', `salas?codigo=eq.${$json.sala}&select=chat_id`);
return [{ json: { ...$json, chat_id: s?.chat_id ?? null } }];""")
e2 = si("¿Hay alguien en Telegram?", [920, 320], "={{ !!$json.chat_id }}")
e3 = tg("Telegram: mandar frase", [1140, 260], "={{ $json.chat_id }}", "=🤟 {{ $json.frase }}")
e4 = nodo("Voz de la frase", "n8n-nodes-base.httpRequest", 4.2, [1360, 260], {
    "url": "=https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&q={{ encodeURIComponent($('¿Hay alguien en Telegram?').item.json.frase.slice(0, 190)) }}",
    "options": {"response": {"response": {"responseFormat": "file"}}}}, **SIGUE)
e5 = nodo("Telegram: mandar audio", "n8n-nodes-base.telegram", 1.2, [1580, 260], {
    "operation": "sendAudio", "chatId": "={{ $('¿Hay alguien en Telegram?').item.json.chat_id }}",
    "binaryData": True, "binaryPropertyName": "data", "additionalFields": {"title": "Mensaje en señas"}}, credentials=TG, **SIGUE)
r3 = responder("Responder enviado", [1800, 260], '={"ok":true,"entregado":true}')
r4 = responder("Responder sin contacto", [1140, 420], '={"ok":true,"entregado":false}')
une(sw, e1, 2); une(e1, e2); une(e2, e3, 0); une(e3, e4); une(e4, e5); une(e5, r3); une(e2, r4, 1)

# -- emergencia
m1 = code("Supabase: contacto de emergencia", [700, 560], SB + r"""
const [s] = await sb('GET', `salas?codigo=eq.${$json.sala}&select=chat_id`);
await sb('POST', 'mensajes', { sala: $json.sala, dir: 'ida', texto: '🚨 EMERGENCIA', glosas: ['ayuda'] }, 'return=minimal');
return [{ json: { ...$json, chat_id: s?.chat_id ?? null, mapa: $json.lat != null ? `https://maps.google.com/?q=${$json.lat},${$json.lon}` : null } }];""")
m2 = tg("Telegram: alerta", [920, 560], "={{ $json.chat_id }}",
        "=🚨 EMERGENCIA — la persona sorda de la sala {{ $json.sala }} pidió ayuda.\n{{ $json.mapa ? '📍 ' + $json.mapa : 'Sin ubicación.' }}", **SIGUE)
m3 = nodo("Telegram: ubicación", "n8n-nodes-base.telegram", 1.2, [1140, 560], {
    "operation": "sendLocation", "chatId": "={{ $('Supabase: contacto de emergencia').item.json.chat_id }}",
    "latitude": "={{ $('Supabase: contacto de emergencia').item.json.lat }}",
    "longitude": "={{ $('Supabase: contacto de emergencia').item.json.lon }}", "additionalFields": {}}, credentials=TG, **SIGUE)
r5 = responder("Responder emergencia", [1360, 560], '={"ok":true}')
une(sw, m1, 3); une(m1, m2); une(m2, m3); une(m3, r5)

# -- resumen
u1 = code("Supabase: leer conversación", [700, 760], SB + r"""
const ms = await sb('GET', `mensajes?sala=eq.${$json.sala}&dir=in.(ida,vuelta)&select=dir,texto&order=id&limit=200`);
const [s] = await sb('GET', `salas?codigo=eq.${$json.sala}&select=chat_id`);
const charla = ms.map(m => (m.dir === 'ida' ? 'Persona sorda (señas): ' : 'Persona oyente (voz): ') + m.texto).join('\n');
return [{ json: { ...$json, charla, n: ms.length, chat_id: s?.chat_id ?? null } }];""")
u2 = ia("IA: resumir", [920, 760],
        "Resume en español, en 3 a 5 viñetas cortas, una conversación entre una persona sorda (que habló en señas) y una oyente. "
        "Di de qué se trató, qué se acordó y qué queda pendiente. Si no hay mensajes, responde 'Sin mensajes todavía.'",
        "$json.charla || '(vacía)'")
u3 = code("Leer resumen", [1140, 760], LEER_IA % "Supabase: leer conversación")
u4 = tg("Telegram: mandar resumen", [1360, 760], "={{ $json.chat_id }}", "=📝 Resumen de la sala {{ $json.sala }}\n\n{{ $json.ia }}", **SIGUE)
r6 = responder("Responder resumen", [1580, 760], "={{ JSON.stringify({ resumen: $('Leer resumen').item.json.ia || 'Sin mensajes todavía.' }) }}")
une(sw, u1, 4); une(u1, u2); une(u2, u3); une(u3, u4); une(u4, r6)

# =================== 2) Telegram → página ===================
t0 = nodo("Telegram → n8n", "n8n-nodes-base.telegramTrigger", 1.1, [0, 1100], {"updates": ["message"], "additionalFields": {}},
          credentials=TG, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "manos-telegram")))
k2 = nodo("Claves (Telegram)", "n8n-nodes-base.code", 2, [220, 1100], {"jsCode": CLAVES})
t1 = switch("¿Qué mandó?", [440, 1100], "={{ $json.message.text }}", [
    ("start", "/start", None, "startsWith"),
    ("voz", "", "={{ $json.message.voice?.file_id ?? $json.message.audio?.file_id }}", "exists"),
    ("texto", "", "={{ $json.message.text }}", "exists")])
une(t0, k2); une(k2, t1)

# -- /start CODIGO: vincular el chat a la sala
v1 = code("Supabase: vincular sala", [700, 940], SB + r"""
const codigo = ($json.message.text.split(/\s+/)[1] || '').toUpperCase();
const nombre = [$json.message.from?.first_name, $json.message.from?.last_name].filter(Boolean).join(' ') || 'Telegram';
const r = codigo ? await sb('PATCH', `salas?codigo=eq.${codigo}`, { chat_id: $json.message.chat.id, nombre }) : [];
const ok = Array.isArray(r) && r.length > 0;
if (ok) await sb('POST', 'mensajes', { sala: codigo, dir: 'aviso', texto: `${nombre} entró a la sala por Telegram` }, 'return=minimal');
return [{ json: { chat_id: $json.message.chat.id, texto: ok
  ? `✅ Listo, ${nombre}. Estás en la sala ${codigo}.\nMandame un audio o un texto y la persona sorda lo verá en señas. Lo que ella diga en señas te llega aquí.`
  : '❌ No encontré esa sala. Abrí el link que te pasaron o escribí /start CODIGO.' } }];""")
v2 = tg("Telegram: bienvenida", [920, 940], "={{ $json.chat_id }}", "={{ $json.texto }}")
une(t1, v1, 0); une(v1, v2)

# -- audio: bajar → Whisper
a1 = nodo("Telegram: bajar audio", "n8n-nodes-base.telegram", 1.2, [700, 1100], {
    "resource": "file", "fileId": "={{ $json.message.voice?.file_id ?? $json.message.audio?.file_id }}", "download": True,
    "additionalFields": {}}, credentials=TG)
a2 = nodo("Preparar audio", "n8n-nodes-base.code", 2, [920, 1100], {"jsCode": r"""
// Telegram manda .oga; Whisper lo acepta si se llama .ogg
return $input.all().map(i => { i.binary.data.fileName = 'voz.ogg'; i.binary.data.mimeType = 'audio/ogg'; return i; });"""})
a3 = nodo("Whisper: audio → texto", "n8n-nodes-base.httpRequest", 4.2, [1140, 1100], {
    "method": "POST", "url": "https://api.groq.com/openai/v1/audio/transcriptions",
    "sendHeaders": True, "headerParameters": {"parameters": [
        {"name": "Authorization", "value": "=Bearer {{ $('Claves (Telegram)').item.json.cfg.GROQ_KEY }}"}]},
    "sendBody": True, "contentType": "multipart-form-data", "bodyParameters": {"parameters": [
        {"parameterType": "formBinaryData", "name": "file", "inputDataFieldName": "data"},
        {"name": "model", "value": "whisper-large-v3"},
        {"name": "language", "value": "es"}]}, "options": {}})
a4 = code("Texto del audio", [1360, 1100], r"""
const t = $('Claves (Telegram)').item.json;
return [{ json: { cfg: t.cfg, chat_id: t.message.chat.id, texto: ($json.text || '').trim() } }];""")
une(t1, a1, 1); une(a1, a2); une(a2, a3); une(a3, a4)

# -- texto escrito
x1 = code("Texto escrito", [700, 1280], r"""
return [{ json: { cfg: $json.cfg, chat_id: $json.message.chat.id, texto: $json.message.text.trim() } }];""")
une(t1, x1, 2)

# -- común: buscar sala → IA glosas → guardar → confirmar
c1 = code("Supabase: sala de este chat", [1580, 1200], SB + r"""
const [s] = await sb('GET', `salas?chat_id=eq.${$json.chat_id}&select=codigo&order=creado.desc&limit=1`);
return [{ json: { ...$json, sala: s?.codigo ?? null } }];""")
c2 = si("¿Está en una sala?", [1800, 1200], "={{ !!$json.sala && !!$json.texto }}")
c3 = ia("IA: texto → señas", [2020, 1140],
        "Convierte una frase en español a glosas de Lengua de Señas Boliviana para un avatar: palabras sueltas, en minúsculas, en infinitivo, "
        "sin artículos ni preposiciones innecesarias, en el orden en que se señarían. Máximo 12 glosas. Si hay nombres propios, déjalos tal cual.",
        "$json.texto",
        {"type": "object", "properties": {"glosas": {"type": "array", "items": {"type": "string"}}},
         "required": ["glosas"], "additionalProperties": False})
c4 = code("Leer glosas", [2240, 1140], r"""
const r = $json, prev = $('¿Está en una sala?').item.json;
let glosas = [];
try { glosas = JSON.parse((r.content || []).filter(b => b.type === 'text').map(b => b.text).join('')).glosas || []; } catch {}
return [{ json: { ...prev, glosas } }];""")
c5 = code("Supabase: guardar para la página", [2460, 1140], SB + r"""
await sb('POST', 'mensajes', { sala: $json.sala, dir: 'vuelta', texto: $json.texto, glosas: $json.glosas }, 'return=minimal');
return [{ json: $json }];""")
c6 = tg("Telegram: confirmar", [2680, 1140], "={{ $json.chat_id }}", "=✅ Se lo mostré en señas: «{{ $json.texto }}»")
c7 = tg("Telegram: falta sala", [2020, 1300], "={{ $json.chat_id }}",
        "=Todavía no estás en ninguna sala. Abrí el link que te pasaron o escribí /start CODIGO.")
une(a4, c1); une(x1, c1); une(c1, c2); une(c2, c3, 0); une(c3, c4); une(c4, c5); une(c5, c6); une(c2, c7, 1)

# Notas visibles en el lienzo
for i, (t, pos, alto) in enumerate([
    ("## 1 · Señas → Telegram\nLa página reconoce las señas y manda las palabras sueltas aquí. La IA arma la frase, la persona la revisa, y n8n la guarda en Supabase y la manda por Telegram en texto y voz.\nTambién: abrir sala, emergencia con ubicación y resumen de la charla.", [-40, -260], 200),
    ("## 2 · Telegram → avatar\nLa persona oyente responde con un audio o un texto. Whisper lo pasa a texto, la IA lo convierte en glosas LSB y n8n lo deja en Supabase. La página lo lee y el avatar lo hace en señas.", [-40, 860], 180)]):
    N.append({"id": str(uuid.uuid4()), "name": f"Nota {i+1}", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1,
              "position": pos, "parameters": {"content": t, "width": 460, "height": alto, "color": 5 if i else 4}})

wf = {"name": "Manos que hablan · Puente n8n", "nodes": N, "connections": C, "settings": {"executionOrder": "v1"}, "pinData": {}}
out = pathlib.Path(__file__).with_name("manos-puente.json")
out.write_text(json.dumps(wf, ensure_ascii=False, indent=2))
print(out, len([n for n in N if 'stickyNote' not in n['type']]), "nodos")
