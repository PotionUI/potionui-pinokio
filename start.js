module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        env: {
          PYTHONUTF8: "1",
          PYTHONUNBUFFERED: "1",
          POTIONUI_STORAGE_PATH: "{{path.resolve(cwd, 'data', 'storage')}}",
          POTIONUI_DB_PATH: "{{path.resolve(cwd, 'data', 'storage', 'db.sqlite')}}",
          POTIONUI_MODELS_DIR: "{{path.resolve(cwd, 'data', 'models')}}"
        },
        message: [
          "python -c \"import os; [os.makedirs(os.environ[k], exist_ok=True) for k in ('POTIONUI_STORAGE_PATH', 'POTIONUI_MODELS_DIR')]\"",
          "python -m uvicorn api:app --host 127.0.0.1 --port {{port}} --limit-concurrency 1000 --timeout-keep-alive 30 --timeout-graceful-shutdown 30"
        ],
        on: [
          {
            event: "/(http:\\/\\/[0-9.:]+)/",
            done: true
          }
        ]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}
