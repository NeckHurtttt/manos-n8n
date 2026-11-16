# Puente n8n — Manos que hablan (versión Nodo Cero)

n8n es el centro: la página solo ve las señas y mueve el avatar. Todo lo demás pasa por el workflow `manos-puente.json`.

```
Señas → página → n8n (IA arma la frase) → la persona revisa → n8n → Supabase + Telegram (texto y voz)
Telegram (audio o texto) → n8n (Whisper + IA → glosas) → Supabase → página → avatar en señas
```

Acciones del webhook `POST /webhook/manos`: `sala`, `frase`, `enviar`, `emergencia`, `resumen`.

## Configurar (unos 20 min)
1. **Supabase**: SQL Editor → correr `puente.sql` (crea `salas` y `mensajes`).
2. **Bot de Telegram**: @BotFather → `/newbot` → guardar el token y el nombre del bot.
3. **n8n** (n8n.cloud o propio, tiene que tener HTTPS): Import from file → `n8n/manos-puente.json`.
   - Crear la credencial de Telegram con el token y elegirla en los nodos de Telegram.
   - Llenar las claves en los dos nodos **Claves** (Supabase service_role, Anthropic y Groq para Whisper).
   - Activar el workflow.
4. **Página**: en `config.js` poner `N8N_URL` (p. ej. `https://equipo.app.n8n.cloud/webhook`) y `TELEGRAM_BOT`.

## Demo
1. Abrir la página → aparece **Sala XXXXXX** → «Invitar por Telegram» → la otra persona abre el link.
2. Hacer señas → n8n arma la frase → «Mandar por n8n» → le llega texto y audio por Telegram.
3. La otra persona responde con un audio → el avatar lo hace en señas.
4. «Resumen» y «Emergencia» también pasan por n8n.

Para cambiar el workflow, editar `generar.py` y correr `python3 n8n/generar.py`.
