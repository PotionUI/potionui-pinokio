# PotionUI for Pinokio

A [Pinokio](https://pinokio.computer) launcher for [PotionUI](https://github.com/PotionUI/PotionUI), the self-hosted AI image and video generation platform.

## What it does

| Menu item | Script | Effect |
| --- | --- | --- |
| Install | `install.js` | Clones PotionUI into `app/` (skipped when `app/.git` exists), creates a Python 3.12 venv in `app/env`, installs the backend with `uv`, installs ffmpeg through conda and builds the frontend |
| Start | `start.js` | Takes a free port from `kernel.port()`, stores `http://127.0.0.1:<port>` as the `url` local variable, then runs PotionUI's backend with uvicorn on that port. The backend serves the built UI itself, so there is one process |
| Open Web UI / Terminal | | Shown while running. The URL is set before launch, as in Pinokio's `open-webui` example, so it does not depend on matching the console output. It can appear a few seconds before the app finishes starting. |
| Update | `update.js` | `git pull` in `app/`, then reruns `install.js` (dependency install and frontend rebuild are idempotent) |
| Reset | `reset.js` | Deletes `app/env`, `app/frontend/node_modules` and `app/frontend/build` |

### Install strategy

- `install.js` declares `requires: { bundle: "ai" }`, as Pinokio's guide asks for AI launchers.
- Python comes from `venv: "env"` with `venv_python: "3.12"` (the pattern in Pinokio's `browser-use` and `open-webui` examples). Pinokio's default Python is older than PotionUI's required 3.12, and `venv_python` makes `uv` create the venv with 3.12 without a conda environment.
- The install uses PotionUI's own pinned requirements (`requirements.txt` with `constraints.txt`) rather than Pinokio's `torch.js`. PotionUI pins a CUDA 13 PyPI torch closure, and `torch.js` would install a different build from another index.
- Extra index installs pass `--index-strategy unsafe-best-match` so `uv` chooses across indexes the way `pip` does. Without it `uv` would take PyPI's torch and ignore the `cu130` or CPU build.
- `./potionui start` is not used. It spawns detached child processes and exits, which a Pinokio daemon cannot supervise. `start.js` runs the same uvicorn command the CLI uses.
- The port is not fixed. The frontend derives its API and WebSocket addresses from `window.location`, and nothing in PotionUI's backend or frontend source refers to port 26730 when the backend serves the built frontend.
- Windows with NVIDIA adds PyTorch's `cu130` index, as PotionUI's own installer does.
- No NVIDIA GPU (AMD, Apple, CPU): installs `requirements-cpu.txt` (PotionUI's "remote" profile). Local generation is unavailable there. Use a remote worker or cloud backends.
- NVIDIA driver 580 or newer is required for the CUDA 13 build.

### Where data lives

`data/` is created next to `app/` and is passed to PotionUI through `POTIONUI_STORAGE_PATH`, `POTIONUI_DB_PATH` and `POTIONUI_MODELS_DIR`:

- `data/storage/` holds the database, generated media and secrets.
- `data/models/` holds downloaded models.

Update and Reset never touch `data/`. Reset also keeps `app/` itself, including anything you placed in `app/content/*/local` and `app/.env`. To start from nothing, delete the launcher folder from Pinokio.

### Sharing models with other launchers

No `fs.link` virtual drive is configured. PotionUI's models folder has its own layout, which does not map onto the per-type folder names other launchers use. Use the app instead: Administration, Models, Folders accepts any existing folder (for example another launcher's models directory) and detects the model types in it.

### First run

If the page is blank right after Start, refresh once: Open Web UI appears before the server finishes starting.


Open the Web UI and create the owner account. From the same machine no claim code is needed.

## Installing from Pinokio

1. Publish this folder as a git repository.
2. In Pinokio, open Discover, click "Download from URL" and enter the repository URL.
3. Click Install, then Start.

## Install as a real folder

The launcher must be a real folder under `PINOKIO_HOME/api`, not a symlink. Pinokio keys running scripts and their `local` variables by the real path, while the menu looks them up by the symlink path, so with a symlink "Open Web UI" never appears. Install with Download from URL, or `git clone` this repository into `PINOKIO_HOME/api/potionui`.

## Publishing

- Tag the GitHub repository with the `pinokio` topic. It then appears in the "latest" section of Discover.
- Featured placement is arranged with the Pinokio team directly.
- Optionally add X posts to `pinokio.json` (`posts`) for the newsfeed.

## Tests

```
node --test test/structure.test.js
```

The tests check script structure, the start port and url wiring, and menu states against a mock `info`, assert that `when` expressions use only documented template helpers, and assert that update and reset never delete `data/`.

## What the maintainer must check in real Pinokio

1. Click Reset, then Install. Confirm `app/` is cloned, `app/env` is Python 3.12 and `app/frontend/build` exists.
2. Confirm the `unsafe-best-match` torch install picks the CUDA build on Windows and the CPU build on non-NVIDIA machines.
3. Confirm `conda install ffmpeg` works in Pinokio's base environment.
4. Start: the menu changes to "Open Web UI" and the URL opens the app. Stop and start again.
5. `data/storage/db.sqlite` exists after the first start.
6. Update after a change to `requirements.txt` or `frontend/` still starts.
7. Reset, then Install again: the same account and models are still there.
8. On a machine without NVIDIA, confirm the CPU install completes (macOS and AMD are untested).
