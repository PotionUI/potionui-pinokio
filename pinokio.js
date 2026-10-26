const uvicornEntries = ["app/env/bin/uvicorn", "app/env/Scripts/uvicorn.exe"]

module.exports = {
  version: "7.0",
  title: "PotionUI",
  description: "PotionUI: self-hosted AI image and video generation with a preset-driven interface, a native diffusers engine and ComfyUI support. Requires Windows or Linux with an NVIDIA GPU (driver 580 or newer, 8 GB VRAM and 16 GB RAM minimum). Other machines get a remote-only install.",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const hasEnv = info.exists("app/env")
    const hasBuild = info.exists("app/frontend/build")
    const hasServer = uvicornEntries.some((entry) => info.exists(entry))
    const installed = hasEnv && hasBuild && hasServer
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js"),
      resetPassword: info.running("reset-password.js")
    }
    if (running.install) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Installing", href: "install.js" }]
    }
    if (running.update) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Updating", href: "update.js" }]
    }
    if (running.resetPassword) {
      return [{ default: true, icon: "fa-solid fa-key", text: "Resetting password", href: "reset-password.js" }]
    }
    if (running.reset) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Resetting", href: "reset.js" }]
    }
    if (!installed) {
      const text = hasEnv || hasBuild ? "Repair install" : "Install"
      return [{ default: true, icon: "fa-solid fa-plug", text, href: "install.js" }]
    }
    if (running.start) {
      const local = info.local("start.js")
      if (local && local.url) {
        return [
          { default: true, icon: "fa-solid fa-rocket", text: "Open Web UI", href: local.url },
          { icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" },
          { icon: "fa-solid fa-key", text: "Reset a password", href: "reset-password.js" }
        ]
      }
      return [
        { default: true, icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" },
        { icon: "fa-solid fa-key", text: "Reset a password", href: "reset-password.js" }
      ]
    }
    return [
      { default: true, icon: "fa-solid fa-power-off", text: "Start", href: "start.js" },
      { icon: "fa-solid fa-plug", text: "Update", href: "update.js" },
      { icon: "fa-solid fa-plug", text: "Install", href: "install.js" },
      { icon: "fa-solid fa-key", text: "Reset a password", href: "reset-password.js" },
      { icon: "fa-regular fa-circle-xmark", text: "Reset", href: "reset.js" }
    ]
  }
}
