module.exports = {
  run: [
    {
      when: "{{exists('app/env')}}",
      method: "fs.rm",
      params: {
        path: "app/env"
      }
    },
    {
      when: "{{exists('app/frontend/node_modules')}}",
      method: "fs.rm",
      params: {
        path: "app/frontend/node_modules"
      }
    },
    {
      when: "{{exists('app/frontend/build')}}",
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
