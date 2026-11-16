# Manos que hablan 🤟

Traductor de **Lengua de Señas Boliviana (LSB)** para el aula, 100 % en el navegador (Abstracthon 2026, track Educación).

- **Alumno (señas → voz):** la cámara sigue manos y cuerpo (MediaPipe), una red neuronal pequeña reconoce la seña y la dice en voz alta.
- **Profesor (voz → señas):** subtítulos en vivo y el video de cada seña conocida.
- **Entrenar:** grabar muestras de cada seña (1 s), video de referencia y entrenar el modelo ahí mismo.
- **Datos:** vocabulario editable; exportar/importar muestras para juntar las de varias personas.

## Usar
```
python3 -m http.server 8000   # y abrir http://localhost:8000 en Chrome
```
La cámara necesita `localhost` o HTTPS (GitHub Pages sirve). La voz → texto necesita Chrome o Edge.

## Primer uso
1. Encender cámara → **Entrenar**.
2. Grabar «reposo» ~20 veces (manos quietas, acomodarse, sin señas).
3. Grabar cada seña 15–20 veces con alguien que sepa LSB (verde = suficiente) y un 🎬 video de referencia.
4. **Entrenar modelo** → pestaña **Alumno**.

## Pruebas
`node pruebas.mjs` — rasgos, red neuronal con manos sintéticas y texto → señas.

## Señas compartidas por el link (Supabase)
Sin configurar, cada navegador guarda sus propias señas. Para que **todos los que abren el link** usen las mismas:
1. Crear un proyecto gratis en https://supabase.com.
2. SQL Editor → pegar `supabase.sql`, **cambiar la clave del equipo** y Run.
3. Project Settings → API: copiar la URL y la clave `anon`/`publishable` en `config.js` y subir.
4. En la app, pestaña **Entrenar** → escribir la clave del equipo. Con clave se graba y entrena; sin clave, solo se usa.
Al entrenar, el modelo se publica y cualquiera que abra el link lo recibe al instante.

## Idiomas
Castellano, inglés y hebreo; quechua, aymara y guaraní en **borrador** (`idiomas.js`, validar con hablantes).
