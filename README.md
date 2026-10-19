# PotionUI for Pinokio

A [Pinokio](https://pinokio.computer) launcher for [PotionUI](https://github.com/PotionUI/PotionUI), the self-hosted AI image and video generation platform.

## What it does

| Menu item | Script | Effect |
| --- | --- | --- |
| Install | `install.js` | Clones PotionUI into `app/`, creates a Python 3.12 conda environment in `env/`, installs the backend dependencies and builds the frontend |
| Start | `start.js` | Runs `python api.py` as a daemon. The backend serves the built UI itself, so there is one process and one port (26730) |
| Open Web UI / Terminal | | Shown while running. The URL is read from the `Uvicorn running on http://127.0.0.1:26730` log line |
| Update | `update.js` | `git pull` in `app/`, then reruns `install.js` (dependency install and frontend rebuild are idempotent) |
| Reset | `reset.js` | Deletes `env/`, `app/frontend/node_modules` and `app/frontend/build` |

### Install strategy

- The install uses PotionUI's own pinned requirements (`requirements.txt` with `constraints.txt`) rather than Pinokio's `torch.js`. PotionUI pins a CUDA 13 PyPI torch closure, and `torch.js` would install a different build from another index.
- `./potionui start` is not used. It installs and then spawns detached child processes and exits, which a Pinokio daemon cannot supervise. The launcher runs the same steps itself.
- Windows with NVIDIA adds PyTorch's `cu130` index, as PotionUI's own installer does.
- No NVIDIA GPU (AMD, Apple, CPU): installs `requirements-cpu.txt` (PotionUI's "remote" profile). Local generation is unavailable there; PotionUI supports NVIDIA CUDA only. Use a remote worker or cloud backends.
- NVIDIA driver 580 or newer is required for the CUDA 13 build.

### Where data lives

`data/` is created next to `app/` and is passed to PotionUI through `POTIONUI_STORAGE_PATH`, `POTIONUI_DB_PATH` and `POTIONUI_MODELS_DIR`:

- `data/storage/` holds the database, generated media and secrets.
- `data/models/` holds downloaded models.

Update and Reset never touch `data/`. Reset also keeps `app/`, including anything you placed in `app/content/*/local` and `app/.env`. To start from nothing, delete the launcher folder from Pinokio.

### Sharing models with other launchers

No `fs.link` virtual drive is configured. PotionUI's models folder has its own layout, which does not map onto the per-type folder names other launchers use. Use the app instead: Administration, Models, Folders accepts any existing folder (for example another launcher's models directory) and detects the model types in it.

### First run

Open the Web UI and create the owner account. From the same machine no claim code is needed.

## Installing from Pinokio

1. Publish this folder as a git repository.
2. In Pinokio, open Discover, click "Download from URL" and enter the repository URL.
3. Click Install, then Start.

## Publishing

- Tag the GitHub repository with the `pinokio` topic. It then appears in the "latest" section of Discover.
- Featured placement is arranged with the Pinokio team directly.
- Optionally add X posts to `pinokio_meta.json` (`posts`) for the newsfeed.

## Tests

```
node --test test/structure.test.js
```

The tests check script structure and menu states against a mock kernel, match the start regex against PotionUI's real startup line, and assert that update and reset never delete `data/`.

## What the maintainer must check in real Pinokio

1. Install on Linux, Windows and macOS. Confirm the conda environment lands in `env/` with Python 3.12 (`conda.path` as an absolute path, plus `python=3.12`).
2. Confirm `npm` and `git` resolve in the shells that do not set `conda` (Pinokio base environment), and that `conda install ffmpeg` works in `env/`.
3. Start: the menu changes to "Open Web UI" once the log line appears, and the URL opens the app. Stop and start again.
4. `data/storage/db.sqlite` exists after the first start.
5. Update: after a `git pull` that changes `requirements.txt` or `frontend/`, the app still starts.
6. Reset, then Install again: the same account and models are still there.
7. On a machine without NVIDIA, confirm the CPU install completes (macOS and AMD are untested).
8. Port 26730 busy: `api.py` hard-codes the port, so Start fails. Free the port.
