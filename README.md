# TURBO ARENA — servidor online

Este servidor hace el matchmaking y retransmite los controles y estados de partida entre dos navegadores. No modifica ni reemplaza tu servidor de leaderboard de GALAXY OMEGA: despliega este servicio por separado.

## Despliegue en Render
1. Sube `server.js`, `package.json` y `render.yaml` a un repositorio GitHub nuevo.
2. En Render, crea un **Web Service** desde ese repositorio.
3. Render detectará `render.yaml`; si lo configuras manualmente: Build Command `npm install`, Start Command `npm start`, Health Check Path `/health`.
4. Espera a que esté `Live`. La dirección será parecida a `https://turbo-arena-matchmaking.onrender.com`.
5. En TURBO ARENA pulsa el engranaje arriba a la derecha y pega `wss://turbo-arena-matchmaking.onrender.com/match` en Servidor online. Haz lo mismo en el otro jugador.

En el plan gratuito de Render, el servicio puede dormirse tras 15 minutos sin tráfico y despertarse con una nueva conexión WebSocket; el primer emparejamiento puede tardar más. Por eso el juego espera hasta 45 segundos antes de ofrecer el bot.

## Cómo se juega
- Ambos jugadores abren el mismo HTML y guardan su nickname.
- Ambos pulsan BUSCAR PARTIDA. Al conectarse dos jugadores, se emparejan automáticamente.
- Si pasan 16 segundos sin rival, el juego pregunta si quieres jugar contra un bot.
- El primer jugador de la sala ejecuta la física y retransmite snapshots; el segundo envía sus controles al anfitrión.

## Comprobar servidor
Abre `https://TU-SERVIDOR.onrender.com/health`; debe responder JSON con `ok: true`. El WebSocket usa la ruta `/match`.

## Importante
El HTML por sí solo no puede crear matchmaking público entre dispositivos. El servidor debe estar desplegado y ambos jugadores deben usar la misma URL WSS. El servidor es un relay de confianza ligera para partidas casuales; no está diseñado como anticheat competitivo ni conserva datos personales.
