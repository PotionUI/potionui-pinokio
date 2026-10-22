# PotionUI for Pinokio

A [Pinokio](https://pinokio.computer) launcher for [PotionUI](https://github.com/PotionUI/PotionUI), the self-hosted AI image and video generation platform.

## Requirements

This launcher installs PotionUI 0.0.17.

- Windows or Linux with an NVIDIA GPU. PotionUI's tested matrix is Linux x86_64 with NVIDIA; native Windows is experimental.
- NVIDIA driver 580 or newer (the CUDA 13 build). Turing or newer cards only (RTX 20xx / GTX 16xx and up); GTX 10-series and older cannot run it.
- Minimum 8 GB VRAM and 16 GB system RAM, which runs the SDXL family. PotionUI recommends 16 to 24 GB VRAM and 32 GB RAM; larger model families need more.
- Disk: models are downloaded on demand and range from a few GB per SDXL checkpoint to about 27 GB for LTX-2/2.3. PotionUI's [Hardware Requirements](https://github.com/PotionUI/PotionUI/blob/master/docs/user/hardware-requirements.md) lists each family.
- Python 3.12 is provided by the launcher.
- macOS and machines without an NVIDIA GPU: Install still works but warns first, then installs the remote-only build. Local generation is unavailable; it only works with a remote worker or a cloud backend.

## What it does

| Menu item | Script | Effect |
| --- | --- | --- |
| Install | `install.js` | Clones PotionUI v0.0.17 into `app/` (skipped when `app/.git` exists), creates a Python 3.12 venv in `app/env` with `uv` (replacing one built with another Python), installs the backend into it with `uv`, checks that the env is Python 3.12 and that `uvicorn`, `fastapi` and `torch` import, installs ffmpeg through conda and builds the frontend with `build-frontend.js`. When the clone, the env or the package install fails it stops there and says so |
| Start | `start.js` | Takes a free port from `kernel.port()`, stores `http://127.0.0.1:<port>` as the `url` local variable, then runs PotionUI's backend with uvicorn on that port. The backend serves the built UI itself, so there is one process |
| Open Web UI / Terminal | | Shown while running. The URL is set before launch, as in Pinokio's `open-webui` example, so it does not depend on matching the console output. It can appear a few seconds before the app finishes starting. |
| Update | `update.js` | Discards the `frontend/package-lock.json` change that `npm install` leaves behind, fetches and checks out the v0.0.17 tag in `app/`, then reruns `install.js` (dependency install and frontend rebuild are idempotent) |
| Reset | `reset.js` | Deletes `app/env`, `app/frontend/node_modules` and `app/frontend/build` |

### Install strategy

- `install.js` declares `requires: { bundle: "ai" }`, as Pinokio's guide asks for AI launchers.
- Python 3.12 comes from `uv`, not from Pinokio's venv handling. `venv_python` did not always take effect (an `app/env` built by Pinokio's default Python 3.10 made `uv` fail with `the current Python version (3.10.x) does not satisfy Python>=3.11`), so no step of `install.js` passes `venv` or `venv_python`. Install first runs the env's own interpreter to check it is 3.12 and deletes `app/env` when it is not, a different version, broken or missing. It then runs `uv venv --python 3.12 env` when `app/env/pyvenv.cfg` does not exist, so `uv` downloads a managed 3.12 if none is installed. The delete-then-create order avoids `uv venv --clear` and its interactive replace prompt, whose behaviour differs between `uv` versions. `start.js` still activates the same `app/env` with `venv: "env"`.
- Every pip step runs `uv pip install --python env/bin/python` (`env\Scripts\python.exe` on Windows), so no shell activation quirk can send the packages to another interpreter.
- The install uses PotionUI's own pinned requirements (`requirements.txt` with `constraints.txt`) rather than Pinokio's `torch.js`. PotionUI pins a CUDA 13 PyPI torch closure, and `torch.js` would install a different build from another index.
- Extra index installs pass `--index-strategy unsafe-best-match` so `uv` chooses across indexes the way `pip` does. Without it `uv` would take PyPI's torch and ignore the `cu130` or CPU build.
- `./potionui start` is not used. It spawns detached child processes and exits, which a Pinokio daemon cannot supervise. `start.js` runs the same uvicorn command the CLI uses.
- The port is not fixed. The frontend derives its API and WebSocket addresses from `window.location`, and nothing in PotionUI's backend or frontend source refers to port 26730 when the backend serves the built frontend.
- Windows with NVIDIA adds PyTorch's `cu130` index, as PotionUI's own installer does.
- No NVIDIA GPU (AMD, Apple, CPU): a warning notification appears before anything is cloned or installed, then `requirements-cpu.txt` (PotionUI's "remote" profile) is installed. Local generation is unavailable there. Use a remote worker or cloud backends.
- The app version is pinned. `install.js` clones `--branch v0.0.17` and `update.js` checks out the same tag, so the installed app is exactly the version the launcher shows. A new PotionUI release reaches users when this launcher changes the tag in `install.js`, `update.js`, the descriptions and the README.
- NVIDIA driver 580 or newer is required for the CUDA 13 build.
- Pinokio keeps running a script after a shell command fails, so `install.js` cannot rely on a failed `uv pip install` stopping it. Instead the verification step deletes `app/env/.deps-verified` and recreates it only when the env's interpreter is Python 3.12 and `uvicorn`, `fastapi` and `torch` import in it. The ffmpeg install, the frontend build and the success notification run only when that file exists; otherwise a notification explains that the install did not finish. The pip steps run only when `app/env/pyvenv.cfg` exists, so a failed clone or a failed env creation installs nothing.
- The menu offers Start only when `app/env`, `app/frontend/build` and the venv's `uvicorn` entry point all exist (`app/env/bin/uvicorn`, or `app/env/Scripts/uvicorn.exe` on Windows). A venv without it shows Repair install (or Install when nothing exists) instead of Start. The entry point is checked rather than the `.deps-verified` file so installs made before that file existed still show Start.
- `build-frontend.js` runs `npm install` and `npm run build` from the frontend folder's real path. Pinokio can start the shell in a spelling with a lowercase drive letter (`g:\pinokio\…`), and the Vite build then resolves `$lib` under `g:` while the files resolve under `G:`, so Rollup fails with a relative path that escapes the drive root.
- Update only discards `frontend/package-lock.json` (tracked, and rewritten by `npm install`). Everything else PotionUI ignores stays untouched: `.env`, `content/*/local`, `frontend/build`, `frontend/node_modules` and `env/` are all in PotionUI's `.gitignore`, and `data/` lives outside `app/`. The checkout is not forced, so an edit to any other tracked file makes git refuse and report it in the terminal instead of being overwritten.

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

## Troubleshooting

### Start says `No module named uvicorn`, or the install log says `the current Python version (3.10.x) does not satisfy Python>=3.11`

The Python packages are not installed in `app/env`: an earlier Install or Update did not finish, or `app/env` was built with the wrong Python. The menu shows **Repair install** in that state, never Start. Click it. Install checks the env's Python, deletes `app/env` and rebuilds it with Python 3.12 when it is not 3.12, reinstalls the packages, checks that `uvicorn`, `fastapi` and `torch` import, and only then builds the frontend. If it fails again, a notification says so; scroll up in the terminal to the first `error:` line (usually a network problem) and click Install once more. `data/` is never touched.

If you want Start working before updating the launcher, run this in a terminal (Linux; `~/pinokio` is your Pinokio home). If `command -v uv` finds nothing, use Pinokio's bundled `uv` (usually `~/pinokio/bin/miniconda/bin/uv`; `find ~/pinokio/bin -name uv -type f` locates it):

```
cd ~/pinokio/api/potionui/app
rm -rf env
uv venv --python 3.12 env
uv pip install --python env/bin/python -r requirements.txt -c constraints.txt
env/bin/python -c "import sys, uvicorn, fastapi, torch; print(sys.version)"
```

The logs are in `logs/api/install.js/` inside the launcher folder, one file per step, with `latest` pointing at the newest.

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

The tests check script structure, the start port and url wiring, and menu states against a mock `info` for the Linux and Windows venv layouts, assert that `when` expressions use only documented template helpers, and assert that update and reset never delete `data/`. They also walk `install.js` with a simulated file system to prove a failed clone, env creation or pip step skips ffmpeg, the frontend build and the success notice and that a Python 3.10 env is rebuilt with 3.12, run the real env check and verification commands against a real venv with stub modules, and run the update commands in a throwaway git repository to prove the lock file restore and that ignored files survive.

## What the maintainer must check in real Pinokio

1. Click Reset, then Install. Confirm `app/` is cloned, `app/env` is Python 3.12 and `app/frontend/build` exists.
2. Confirm the `unsafe-best-match` torch install picks the CUDA build on Windows and the CPU build on non-NVIDIA machines.
3. Confirm `conda install ffmpeg` works in Pinokio's base environment.
4. Start: the menu changes to "Open Web UI" and the URL opens the app. Stop and start again.
5. `data/storage/db.sqlite` exists after the first start.
6. Update after a change to `requirements.txt` or `frontend/` still starts.
7. Reset, then Install again: the same account and models are still there.
8. On a machine without NVIDIA, confirm the CPU install completes (macOS and AMD are untested).
9. With `app/env` built by another Python (or with `env/bin/python` deleted), click Install: it deletes the env, creates a new one with Python 3.12 and everything verifies.
10. Run `uv pip uninstall uvicorn` in `app/env`, reopen the launcher: the menu shows Repair install, not Start. Click it, and Start works again.
