# sofie-tsr-open-live

A [Sofie](https://github.com/Sofie-Automation/sofie-core) TSR plugin that drives an
[Open Live](https://github.com/Eyevinn/open-live) production. It uses Open Live's
automation control contract (open-live#209, contract 1.x) over the controller WebSocket.

Status: **v0.1, local development.** Unit and fake-server tests pass. The plugin loads in
`sofie-core-playout-gateway:v26.9.2`. It has not been run against a live Open Live yet.

## What it does

| Sofie mapping | Timeline content | Open Live commands |
|---|---|---|
| `program` | `{ type: 'program', input, transition? }` | `CUT` / `TRANSITION` |
| `preview` | `{ type: 'preview', input }` (lookahead) | `SET_PVW` |
| `dsk` (layer) | `{ type: 'dsk' }` while active | `DSK_TOGGLE` |
| `graphic` (overlayId) | `{ type: 'graphic' }` while active | `GRAPHIC_ON` / `GRAPHIC_OFF` |
| `audio` (elementId) | `{ type: 'audio', volume?, muted?, rampMs? }` | `AUDIO_SET` |
| `clip` (mixerInput) | `{ type: 'clip', clipId?, playing? }` while active | `CLIP_CUE` → `CLIP_PLAY`, `CLIP_PAUSE`, `CLIP_STOP` |
| `onAir` | `{ type: 'onAir', onAir }` (explicit; removing it does nothing) | `GO_LIVE` / `CUT_STREAM` |
| `ftb` | `{ type: 'ftb', durationMs? }` while active | `FTB` |

Every timeline object sets `deviceType: 'OPEN_LIVE'`. Actions: `resync`, `runMacro`.

Commands run in this order: clips are cued before the cut, and program is set before preview.

- **Connect / reconnect:** the plugin waits for `HELLO … SNAPSHOT_END` and resets TSR to the
  state Open Live reports. After that, only the differences are sent. A clip that is
  already playing is not re-rolled after a reconnect.
- **Commands:** each command gets a `cmdId`. `ACK executed` completes it. A `NACK` is
  reported to Sofie as a command error. If only `accepted` arrives before the timeout,
  the plugin logs a warning.
- **Auth:** `none`, `apiKey` (sent as `Authorization: Bearer`, for self-hosted Open Live),
  or `osc`. In `osc` mode the plugin exchanges your PAT for a SAT and sends it in the
  `osc.bearer` subprotocol pair.
- **Keep-alive:** the plugin sends `KEEP_ALIVE` (default every 30 s) so the idle watchdog
  doesn't deactivate a production that automation is driving.

## Build and test

```bash
npm install
npm test
npm run build      # dist/ + manifest.json + translations.json
```

## Playout gateway image

```bash
docker build -t sofie-playout-gateway-openlive .
```

The `GATEWAY_IMAGE` build arg selects the upstream gateway. The default is
`ghcr.io/sofie-automation/sofie-core-playout-gateway:v26.9.2`, which uses TSR 10.0.0, the
same version as this plugin. The upstream image is amd64-only.

## Blueprints

Import the types and this package's `TimelineContentMap` augmentation comes with them:

```ts
import { OpenLiveDeviceType, TimelineContentTypeOpenLive } from 'sofie-tsr-open-live'
```

## Not yet covered

PiP (`SET_PIP` / `SELECT_PVW_PIP` / `TAKE pip`), AFV, aux/group sends, video effects,
HTML source events, guest returns, and contribution-tally feedback to Sofie.
