module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "git checkout -- frontend/package-lock.json"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "git fetch --depth 1 origin master"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "git checkout -B master FETCH_HEAD"
      }
    },
    {
      method: "script.start",
      params: {
        uri: "install.js"
      }
    }
  ]
}
