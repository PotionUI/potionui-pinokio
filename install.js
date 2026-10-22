const posixPython = "env/bin/python"
const windowsPython = "env\\Scripts\\python.exe"

const dropWrongEnv = (python) => `${python} -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)" || python -c "import shutil; shutil.rmtree('env', ignore_errors=True)"`

const verifyEnv = (python) => `${python} -c "import pathlib, sys; marker = pathlib.Path('env/.deps-verified'); marker.unlink(missing_ok=True); assert sys.version_info[:2] == (3, 12), sys.version; import uvicorn, fastapi, torch; marker.touch()"`

module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      when: "{{gpu !== 'nvidia'}}",
      method: "notify",
      params: {
        html: "No NVIDIA GPU detected. Local generation needs Windows or Linux with an NVIDIA GPU (driver 580 or newer). This install is the remote-only build: it works only with a remote worker or a cloud backend."
      }
    },
    {
      when: "{{exists('app') && !(exists('app/api.py') && exists('app/requirements.txt'))}}",
      method: "fs.rm",
      params: {
        path: "app"
      }
    },
    {
      when: "{{!(exists('app/api.py') && exists('app/requirements.txt'))}}",
      method: "shell.run",
      params: {
        message: "git clone --depth 1 --branch v0.0.17 https://github.com/PotionUI/PotionUI.git app"
      }
    },
    {
      when: "{{exists('app/api.py') && exists('app/requirements.txt') && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: dropWrongEnv(posixPython)
      }
    },
    {
      when: "{{exists('app/api.py') && exists('app/requirements.txt') && platform === 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: dropWrongEnv(windowsPython)
      }
    },
    {
      when: "{{exists('app/api.py') && exists('app/requirements.txt') && !exists('app/env/pyvenv.cfg')}}",
      method: "shell.run",
      params: {
        path: "app",
        message: "uv venv --python 3.12 env"
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && gpu === 'nvidia' && platform === 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: `uv pip install --python ${windowsPython} -r requirements.txt -c constraints.txt --extra-index-url https://download.pytorch.org/whl/cu130 --index-strategy unsafe-best-match`
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && gpu === 'nvidia' && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: `uv pip install --python ${posixPython} -r requirements.txt -c constraints.txt`
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && gpu !== 'nvidia' && platform === 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: `uv pip install --python ${windowsPython} -r requirements-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match`
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && gpu !== 'nvidia' && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: `uv pip install --python ${posixPython} -r requirements-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match`
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: verifyEnv(posixPython)
      }
    },
    {
      when: "{{exists('app/env/pyvenv.cfg') && platform === 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        message: verifyEnv(windowsPython)
      }
    },
    {
      when: "{{exists('app/env/.deps-verified')}}",
      method: "shell.run",
      params: {
        message: "conda install -y -c conda-forge ffmpeg"
      }
    },
    {
      when: "{{exists('app/env/.deps-verified')}}",
      method: "shell.run",
      params: {
        path: "app/frontend",
        message: "node ../../build-frontend.js"
      }
    },
    {
      when: "{{!exists('app/env/.deps-verified')}}",
      method: "notify",
      params: {
        html: "PotionUI is not installed: the app download, the Python 3.12 environment or its packages did not finish, so the frontend was not built. Scroll up in the terminal to the first error (usually a network problem), then click Install again. Your data folder was not touched."
      }
    },
    {
      when: "{{exists('app/env/.deps-verified') && !exists('app/frontend/build')}}",
      method: "notify",
      params: {
        html: "The Python packages are installed but the frontend build failed. Scroll up in the terminal to the first error, then click Install again."
      }
    },
    {
      when: "{{exists('app/env/.deps-verified') && exists('app/frontend/build') && gpu !== 'nvidia'}}",
      method: "notify",
      params: {
        html: "Installed the CPU-only build. PotionUI cannot generate locally without an NVIDIA GPU; connect a remote worker or a cloud backend after the first launch."
      }
    },
    {
      when: "{{exists('app/env/.deps-verified') && exists('app/frontend/build') && gpu === 'nvidia'}}",
      method: "notify",
      params: {
        html: "PotionUI is installed. Click Start."
      }
    }
  ]
}
