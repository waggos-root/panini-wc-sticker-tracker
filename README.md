# Panini World Cup 2026 Tracker

Tablero local para controlar cromos del álbum Panini Mundial 2026.

## Estructura

```text
.
├── package.json
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── App.jsx
│   ├── api.js
│   ├── index.css
│   ├── main.jsx
│   └── stickers.js
├── server/
│   ├── database.js
│   ├── seed.js
│   └── server.js
└── data/
    └── panini-2026.sqlite
```

## Instalar

```bash
npm install
```

## Ejecutar

```bash
npm run start
```

Frontend:

```text
http://localhost:5173
```

Backend/API:

```text
http://localhost:3001/api/stickers
```

## Funcionamiento

- Si `data/panini-2026.sqlite` no existe, se crea automáticamente.
- Si la tabla `stickers` está vacía, se ejecuta el seed.
- 1 clic sobre un cromo suma 1.
- Cantidad 1 = lo tienes.
- Cantidad 2 o más = repetido.
- Botón `-` resta uno.
- Botón `0` marca faltante.
- Botón `1` corrige a una sola copia.
