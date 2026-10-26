module.exports = {
  run: [
    {
      method: "input",
      params: {
        title: "Reset a password",
        description: "Sets a new password for an account in this install. It runs on this computer only, so access to this computer is the proof. Leave Username empty to reset the owner account; the terminal then shows which username to sign in with.",
        form: [
          { key: "username", title: "Username", placeholder: "Empty resets the owner account" },
          { key: "password", title: "New password", type: "password" },
          { key: "repeat", title: "Repeat new password", type: "password" }
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        env: {
          PYTHONUTF8: "1",
          POTIONUI_STORAGE_PATH: "{{path.resolve(cwd, 'data', 'storage')}}",
          POTIONUI_DB_PATH: "{{path.resolve(cwd, 'data', 'storage', 'db.sqlite')}}",
          POTIONUI_MODELS_DIR: "{{path.resolve(cwd, 'data', 'models')}}",
          POTIONUI_RESET_USERNAME: "{{input.username || ''}}",
          POTIONUI_NEW_PASSWORD: "{{input.password || ''}}",
          POTIONUI_NEW_PASSWORD_REPEAT: "{{input.repeat || ''}}"
        },
        message: "python scripts/reset_password.py"
      }
    }
  ]
}
