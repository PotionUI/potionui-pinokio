module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "git fetch --depth 1 origin tag v0.0.16"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "git checkout v0.0.16"
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
