# 4kiscan · Evaluador de operaciones cripto

Herramienta 100 % estática (HTML + CSS + JavaScript, sin build, sin Streamlit, sin React). Funciona como una **entrevista**: pregunta por la operación (tipo, proveedor, red de origen y destino, token, monto, direcciones, hash, tiempo transcurrido), consulta la blockchain cuando hay hash y entrega un **dictamen imparcial**:

- si la operación se hizo bien o qué se hizo mal,
- por qué los fondos no están accesibles o no llegaron,
- si son recuperables y qué pasos seguir,
- conceptos explicados en lenguaje claro (red, memo/tag, bridge, confirmaciones, etc.).

Cada afirmación indica su base: **cadena** (verificado en la blockchain), **declarado** (lo dijo el usuario) o **inferido**, con nivel de confianza y límites. Si una consulta falla, el resultado es «no determinado», nunca «los fondos no existen».

## Uso

Abre `index.html` en el navegador (funciona con `file://`) o sirve la carpeta:

```
npm run serve   # http://localhost:8080
```

Para las verificaciones on-chain se necesita una API key de Alchemy (⚙ Configuración). Se guarda solo en `sessionStorage`, o en `localStorage` si marcas «recordar». Sin clave, la evaluación se hace solo con lo declarado y lo indica claramente.

La interfaz está disponible en español, inglés y portugués. El inglés es el idioma inicial; la selección se guarda en el navegador.

Redes EVM soportadas: Ethereum, Polygon, Optimism, Arbitrum, Base.

## Diseño por dispositivo

- **Móvil (< 40 em):** una columna; botones y opciones a ancho completo (≥ 44 px), barra de acciones fija abajo en el resultado, apartados de detalle plegados (el resultado pasa de ~5.500 px a ~1.800 px), botón «Volver a la pregunta anterior», diálogo de la clave como hoja inferior, márgenes seguros (notch) y teclado adecuado por campo.
- **Tableta (40–64 em):** columna centrada con más aire; objetivos táctiles ampliados en pantallas táctiles.
- **Escritorio (≥ 64 em):** resumen del dictamen y acciones en un panel lateral que acompaña la lectura, detalles abiertos, datos en dos columnas, atajos de teclado (teclas 1–9 eligen una opción) y estados hover solo con puntero fino.
- Respeta modo claro/oscuro, movimiento reducido, colores forzados e impresión (los apartados plegados se abren al imprimir).

## Estructura

| Ruta | Contenido |
|---|---|
| `index.html`, `css/styles.css` | Interfaz (CSP estricta, modo claro/oscuro, accesible) |
| `js/app.js` | Estado y vistas de la entrevista |
| `js/interview.js` | Preguntas, validación y flujo |
| `js/evidence.js` | Recolección de evidencia on-chain |
| `js/evaluate.js` | Motor de evaluación (26 veredictos) |
| `js/report.js` | Informe copiable |
| `js/diagnose.js`, `js/radar.js` | Diagnóstico de origen y búsqueda en destino (puerto de la app original) |
| `js/rpc.js`, `js/input.js`, `js/util.js` | Alchemy/DefiLlama/LI.FI, validación de entradas, utilidades |
| `js/data.js`, `js/providers.js`, `js/concepts.js` | Redes, catálogo de bridges/DEX, proveedores, glosario |

## Pruebas

```
npm test    # node --test, 134 pruebas unitarias, sin dependencias
```

Además se validó en navegador real (Playwright con red simulada): entrevista completa, modo claro/oscuro, móvil, `file://` y ausencia de violaciones CSP.

## Limitaciones

- Las entradas heredadas del catálogo que no están marcadas como verificadas se señalan como tales.
- Una dirección candidata dudosa del catálogo de Polygon se omitió a propósito.
- El dictamen es informativo: no sustituye al soporte del proveedor.
