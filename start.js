module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        conda: { path: "{{path.resolve(cwd, 'env')}}" },
        env: {
          PYTHONUTF8: "1",
          PYTHONUNBUFFERED: "1",
          POTIONUI_STORAGE_PATH: "{{path.resolve(cwd, 'data', 'storage')}}",
          POTIONUI_DB_PATH: "{{path.resolve(cwd, 'data', 'storage', 'db.sqlite')}}",
          POTIONUI_MODELS_DIR: "{{path.resolve(cwd, 'data', 'models')}}"
        },
        message: [
          "python -c \"import os; [os.makedirs(os.environ[k], exist_ok=True) for k in ('POTIONUI_STORAGE_PATH', 'POTIONUI_MODELS_DIR')]\"",
          "python api.py"
        ],
        on: [
          {
            event: "/Uvicorn running on[^h]*(http:\\/\\/[0-9.]+:[0-9]+)/",
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
