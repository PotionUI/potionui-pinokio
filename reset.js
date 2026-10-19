module.exports = {
  run: [
    {
      when: "{{kernel.exists(cwd, 'env')}}",
      method: "fs.rm",
      params: {
        path: "env"
      }
    },
    {
      when: "{{kernel.exists(cwd, 'app', 'frontend', 'node_modules')}}",
      method: "fs.rm",
      params: {
        path: "app/frontend/node_modules"
      }
    },
    {
      when: "{{kernel.exists(cwd, 'app', 'frontend', 'build')}}",
      method: "fs.rm",
      params: {
        path: "app/frontend/build"
      }
    },
    {
      method: "notify",
      params: {
        html: "Environment removed. Your data folder was kept. Click Install to set up again."
      }
    }
  ]
}
