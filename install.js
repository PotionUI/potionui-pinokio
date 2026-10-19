module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      when: "{{!exists('app/.git')}}",
      method: "shell.run",
      params: {
        message: "git clone https://github.com/PotionUI/PotionUI.git app"
      }
    },
    {
      when: "{{gpu === 'nvidia' && platform === 'win32'}}",
      method: "shell.run",
      params: {
        venv: "env",
        venv_python: "3.12",
        path: "app",
        message: "uv pip install -r requirements.txt -c constraints.txt --extra-index-url https://download.pytorch.org/whl/cu130 --index-strategy unsafe-best-match"
      }
    },
    {
      when: "{{gpu === 'nvidia' && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        venv: "env",
        venv_python: "3.12",
        path: "app",
        message: "uv pip install -r requirements.txt -c constraints.txt"
      }
    },
    {
      when: "{{gpu !== 'nvidia'}}",
      method: "shell.run",
      params: {
        venv: "env",
        venv_python: "3.12",
        path: "app",
        message: "uv pip install -r requirements-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match"
      }
    },
    {
      method: "shell.run",
      params: {
        message: "conda install -y -c conda-forge ffmpeg"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app/frontend",
        message: [
          "npm install",
          "npm run build"
        ]
      }
    },
    {
      when: "{{gpu !== 'nvidia'}}",
      method: "notify",
      params: {
        html: "Installed the CPU-only build. PotionUI cannot generate locally without an NVIDIA GPU; connect a remote worker or a cloud backend after the first launch."
      }
    },
    {
      when: "{{gpu === 'nvidia'}}",
      method: "notify",
      params: {
        html: "PotionUI is installed. Click Start."
      }
    }
  ]
}
