const fs = require("fs")
const path = require("path")

const readRunUrl = () => {
  try {
    const run = JSON.parse(fs.readFileSync(path.resolve(__dirname, "data", "run.json"), "utf8"))
    return typeof run.url === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(run.url) ? run.url : null
  } catch (e) {
    return null
  }
}

const probe = (fn) => {
  try {
    return String(fn())
  } catch (e) {
    return "ERR " + (e && e.message)
  }
}

const diagnostics = (info) => {
  const local = probe(() => JSON.stringify(info.local("start.js")))
  const file = probe(() => {
    const raw = fs.readFileSync(path.resolve(__dirname, "data", "run.json"), "utf8")
    return "ok " + raw.length
  })
  const lines = [
    "dbg local=" + local,
    "dbg req=" + probe(() => typeof require) + " dir=" + probe(() => typeof __dirname),
    "dbg file=" + file + " d=" + probe(() => __dirname)
  ]
  return lines.map((text) => ({ icon: "fa-solid fa-bug", text: text.slice(0, 120), href: "start.js" }))
}

module.exports = {
  version: "7.0",
  title: "PotionUI",
  description: "Self-hosted AI image and video generation with a preset-driven interface, a native diffusers engine and ComfyUI support.",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const installed = info.exists("app/env") && info.exists("app/frontend/build")
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js")
    }
    if (running.install) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Installing", href: "install.js" }]
    }
    if (running.update) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Updating", href: "update.js" }]
    }
    if (running.reset) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Resetting", href: "reset.js" }]
    }
    if (!installed) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Install", href: "install.js" }]
    }
    if (running.start) {
      const dbg = diagnostics(info)
      const local = info.local("start.js")
      const url = (local && local.url) || readRunUrl()
      if (url) {
        return [
          ...dbg,
          { default: true, icon: "fa-solid fa-rocket", text: "Open Web UI", href: url },
          { icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" }
        ]
      }
      return [...dbg, { default: true, icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" }]
    }
    return [
      { default: true, icon: "fa-solid fa-power-off", text: "Start", href: "start.js" },
      { icon: "fa-solid fa-plug", text: "Update", href: "update.js" },
      { icon: "fa-solid fa-plug", text: "Install", href: "install.js" },
      { icon: "fa-regular fa-circle-xmark", text: "Reset", href: "reset.js" }
    ]
  }
}
