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
