# ReelSort

ReelSort is a local-first web app for quickly reviewing downloaded videos before adding them to a clean Jellyfin library.

Repository: https://github.com/the-e3n/reelsort

## Features

- Fast library browsing with list and card views.
- Filter mode with keyboard-first controls.
- Soft delete workflow with dedicated Trash view and permanent delete.
- Persistent decisions and playback metadata in SQLite.
- Folder scan with live progress reporting.
- Poster pairing using the pattern: `${name}-poster.{ext}`.
- Root + one-level nested folder indexing support.
- URL-synced view state (tab and filter context survive reload).

Filter mode shortcuts (case-insensitive):

- K: keep video
- P then P: move video to trash
- A: seek backward by configured interval
- D: seek forward by configured interval
- S: play/pause toggle
- Left Arrow: previous video
- Right Arrow: next video

## Quick Start (Docker Image)

Use the published image from GHCR:

```bash
docker run --rm \
  -p 4000:4000 \
  -v reelsort-data:/app/server/data \
  -v /path/on/server/media:/media \
  ghcr.io/the-e3n/reelsort:latest
```

Then open http://localhost:4000 and set media path to `/media` in Settings.

## Quick Start (Docker Compose)

This repository includes `docker-compose.yml` for local testing.
For production deployments, you may want to customize the compose file to your needs.
A sample compose snippet is below:

```docker-compose
services: 
  reelsort: 
    image: ghcr.io/the-e3n/reelsort:latest 
    container_name: reelsort 
    ports: 
      - "4000:4000" 
    volumes: 
      - path/to/media:/media # /media can be any path inside container. Final path can be configured in ui 
      - reelsort_data:/app/server/data 
    restart: unless-stopped
  volumes:
    reelsort_data:
```

```bash
docker compose up -d --build
```

Default test mapping in compose:

- SQLite/data volume: `/app/server/data`
- Sample media mount: `./sample` -> `/media`

Open http://localhost:4000 and set media path to `/media`.

## Configuration

Configure from the Settings page:

- Media folder path: absolute path inside container or host runtime context
- Skip interval seconds: used by A/D shortcuts
- Default queue scope for filter mode

Operational notes:

- Persist `/app/server/data` to keep decisions across restarts.
- Mount media read/write if you will permanently delete files.
- Mount media read-only if you only want review and no destructive delete.

## Run Locally (Node.js)

Requirements:

- Node.js 22+
- npm 10+

Install:

```bash
npm install
```

Development mode (server + web dev server):

```bash
npm run dev
```

Open http://localhost:5173

Production-style local run:

```bash
npm run build
npm run start --workspace server
```

Open http://localhost:4000

## Build and Publish Image (GitHub Actions)

Workflow file: `.github/workflows/docker-image.yml`

- Pull requests: build image only
- Push to main: build and push image
- Version tags (`v*`): build and publish versioned tags

Published image target:

- `ghcr.io/the-e3n/reelsort:latest`

If package visibility is private, configure registry auth in Docker/Portainer with a GitHub token that can read packages.

## Project Structure

- `server/`: Express API, scan services, SQLite persistence
- `web/`: React + Vite frontend
- `sample/`: sample media for local testing

# AI Disclosure
This project is generated using copilot however i have vetted everything. Also i have used this for my own library but still please proceed with caution.

