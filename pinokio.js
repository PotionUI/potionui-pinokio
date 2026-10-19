const label = (text, icon, href, extra = {}) => ({ icon, text, href, ...extra })

module.exports = {
  version: "1.0",
  title: "PotionUI",
  description: "Self-hosted AI image and video generation with a preset-driven interface, a native diffusers engine and ComfyUI support.",
  icon: "icon.png",
  menu: async (kernel) => {
    const running = (file) => kernel.script.running(__dirname, file)
    const installed = (await kernel.exists(__dirname, "env")) && (await kernel.exists(__dirname, "app", "frontend", "build"))

    if (running("install.js")) {
      return [label("Installing", "fa-solid fa-plug", "install.js")]
    }
    if (running("update.js")) {
      return [label("Updating", "fa-solid fa-rotate", "update.js")]
    }
    if (running("reset.js")) {
      return [label("Resetting", "fa-solid fa-broom", "reset.js")]
    }
    if (!installed) {
      return [label("Install", "fa-solid fa-plug", "install.js")]
    }
    if (running("start.js")) {
      const url = kernel.script.local(__dirname, "start.js").url
      if (url) {
        return [
          label("Open Web UI", "fa-solid fa-rocket", url, { target: "_blank" }),
          label("Terminal", "fa-solid fa-terminal", "start.js")
        ]
      }
      return [label("Starting", "fa-solid fa-terminal", "start.js")]
    }
    return [
      label("Start", "fa-solid fa-power-off", "start.js"),
      label("Update", "fa-solid fa-rotate", "update.js"),
      label("Reset", "fa-solid fa-broom", "reset.js")
    ]
  }
}
