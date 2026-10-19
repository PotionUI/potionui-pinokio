module.exports = {
  run: [
    {
      when: "{{!kernel.exists(cwd, 'app', '.git')}}",
      method: "shell.run",
      params: {
        message: "git clone https://github.com/PotionUI/PotionUI.git app"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        conda: {
          path: "{{path.resolve(cwd, 'env')}}",
          python: "python=3.12"
        },
        message: [
          "python -m pip install --upgrade pip",
          "conda install -y -c conda-forge ffmpeg"
        ]
      }
    },
    {
      when: "{{gpu === 'nvidia' && platform === 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        conda: { path: "{{path.resolve(cwd, 'env')}}" },
        message: "python -m pip install -r requirements.txt -c constraints.txt --extra-index-url https://download.pytorch.org/whl/cu130"
      }
    },
    {
      when: "{{gpu === 'nvidia' && platform !== 'win32'}}",
      method: "shell.run",
      params: {
        path: "app",
        conda: { path: "{{path.resolve(cwd, 'env')}}" },
        message: "python -m pip install -r requirements.txt -c constraints.txt"
      }
    },
    {
      when: "{{gpu !== 'nvidia'}}",
      method: "shell.run",
      params: {
        path: "app",
        conda: { path: "{{path.resolve(cwd, 'env')}}" },
        message: "python -m pip install -r requirements-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu"
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
