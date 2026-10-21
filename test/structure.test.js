const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const load = (name) => require(path.join(root, name))
const PORT = 42003
const scriptOf = async (name) => {
  const loaded = load(name)
  return typeof loaded === "function" ? loaded({ port: async () => PORT }) : loaded
}
const scripts = ["install.js", "start.js", "update.js", "reset.js"]

const parseEvent = (source) => {
  const match = source.match(/^\/(.*)\/([a-z]*)$/)
  assert.ok(match, `event is not a /regex/ literal: ${source}`)
  return new RegExp(match[1], match[2])
}

const flatten = (value) => JSON.stringify(value)

test("every script exports a run array of method steps", async () => {
  for (const name of scripts) {
    const script = await scriptOf(name)
    assert.ok(Array.isArray(script.run) && script.run.length > 0, `${name}: run`)
    for (const step of script.run) {
      assert.equal(typeof step.method, "string", `${name}: method`)
    }
  }
})

test("only start.js is a daemon", async () => {
  assert.strictEqual((await scriptOf("start.js")).daemon, true)
  for (const name of ["install.js", "update.js", "reset.js"]) {
    assert.notStrictEqual(load(name).daemon, true, name)
  }
})

const launchStep = async () => (await scriptOf("start.js")).run[2]

test("start.js mirrors the open-webui example: url set before launch, uvicorn on the same port", async () => {
  const [prepare, remember, launch] = (await scriptOf("start.js")).run
  assert.equal(prepare.method, "shell.run")
  assert.equal(remember.method, "local.set")
  assert.equal(remember.params.url, `http://127.0.0.1:${PORT}`)
  assert.equal(launch.method, "shell.run")
  assert.equal(typeof launch.params.message, "string")
  assert.ok(launch.params.message.startsWith(`python -m uvicorn api:app --host 127.0.0.1 --port ${PORT} `))
  assert.equal(launch.params.path, "app")
  assert.equal(launch.params.venv, "env")
})

test("start.js does not depend on the console regex for the url", async () => {
  const run = (await scriptOf("start.js")).run
  const remember = run.findIndex((step) => step.method === "local.set")
  const launch = run.findIndex((step) => step.params.on)
  assert.ok(remember >= 0 && remember < launch)
  assert.ok(!flatten(run[remember]).includes("input.event"))
})

test("start.js readiness event is the generic upstream URL pattern and keeps the shell alive", async () => {
  const [handler] = (await launchStep()).params.on
  assert.strictEqual(handler.done, true)
  assert.equal(handler.event, "/http:\\/\\/[0-9.:]+/")
  assert.ok(parseEvent(handler.event).test("Uvicorn running on http://127.0.0.1:42003 (Press CTRL+C to quit)"))
})

test("start.js ignores error: and errno lines like the ComfyUI launcher, so Pinokio's default break handlers cannot close the readiness event", async () => {
  const handlers = (await launchStep()).params.on
  for (const event of ["/error:/i", "/errno/i"]) {
    const handler = handlers.find((item) => item.event === event)
    assert.ok(handler, event)
    assert.strictEqual(handler.break, false)
  }
})

test("start.js keeps storage, database and models outside the app checkout", async () => {
  const env = (await launchStep()).params.env
  for (const key of ["POTIONUI_STORAGE_PATH", "POTIONUI_DB_PATH", "POTIONUI_MODELS_DIR"]) {
    assert.match(env[key], /path\.resolve\(cwd, 'data'/, key)
  }
})

test("start.js creates the data folders before launching", async () => {
  const [prepare] = (await scriptOf("start.js")).run
  assert.ok(prepare.params.message.includes("os.makedirs"))
  assert.ok(prepare.params.env.POTIONUI_STORAGE_PATH.includes("'data'"))
})

test("start.js takes its port from kernel.port, not a constant", async () => {
  const other = await load("start.js")({ port: async () => 51111 })
  assert.equal(other.run[1].params.url, "http://127.0.0.1:51111")
  assert.ok(other.run[2].params.message.includes("--port 51111"))
  assert.ok(!/2673[01]/.test(flatten(other)))
})

test("update.js never deletes anything and reruns install", () => {
  const update = load("update.js")
  assert.ok(!update.run.some((step) => step.method.startsWith("fs.")))
  assert.ok(update.run.some((step) => step.params.message === "git checkout v0.0.16" && step.params.path === "app"))
  assert.ok(update.run.some((step) => step.method === "script.start" && step.params.uri === "install.js"))
})

test("reset.js removes only the environment and frontend artefacts", () => {
  const removals = load("reset.js").run.filter((step) => step.method === "fs.rm")
  const removed = removals.map((step) => step.params.path)
  assert.deepEqual(removed.sort(), ["app/env", "app/frontend/build", "app/frontend/node_modules"])
  assert.ok(!/data|storage|models/.test(flatten(removals)))
})

test("install.js removes only app and nothing else deletes files", async () => {
  const removed = load("install.js").run.filter((step) => step.method === "fs.rm").map((step) => step.params.path)
  assert.deepEqual(removed, ["app"])
  for (const name of ["start.js", "update.js"]) {
    assert.ok(!/fs\.rm|rm -rf|rmdir|del /.test(flatten(await scriptOf(name))), name)
  }
})

test("install.js declares the AI bundle and installs with uv into a Python 3.12 venv", () => {
  const install = load("install.js")
  assert.deepEqual(install.requires, { bundle: "ai" })
  const pip = install.run.filter((step) => String(step.params.message).includes("uv pip install -r"))
  assert.equal(pip.length, 3)
  for (const step of pip) {
    assert.equal(step.params.venv, "env")
    assert.equal(step.params.venv_python, "3.12")
    assert.equal(step.params.path, "app")
  }
  assert.ok(!flatten(install).includes("pip install --upgrade"))
})

test("install.js branches pip installs on gpu and platform", () => {
  const pip = load("install.js").run.filter((step) => String(step.params.message).includes("uv pip install -r"))
  const nvidiaWindows = pip.find((step) => step.when.includes("win32") && step.when.includes("=== 'nvidia'"))
  assert.ok(nvidiaWindows.params.message.includes("constraints.txt"))
  assert.ok(nvidiaWindows.params.message.includes("whl/cu130"))
  assert.ok(nvidiaWindows.params.message.includes("--index-strategy unsafe-best-match"))
  const nvidiaPosix = pip.find((step) => step.when.includes("!== 'win32'"))
  assert.ok(nvidiaPosix.params.message.includes("constraints.txt"))
  assert.ok(!nvidiaPosix.params.message.includes("--extra-index-url"))
  const cpu = pip.find((step) => step.when === "{{gpu !== 'nvidia'}}")
  assert.ok(cpu.params.message.includes("requirements-cpu.txt"))
  assert.ok(cpu.params.message.includes("whl/cpu"))
  assert.ok(!cpu.params.message.includes("constraints.txt"))
})

const evaluateWhen = (step, existing) => {
  if (!step.when) return true
  const expression = step.when.match(/^\{\{([\s\S]*)\}\}$/)[1]
  const exists = (relative) => existing.includes(relative)
  return Boolean(new Function("exists", "gpu", "platform", `return (${expression})`)(exists, "nvidia", "linux"))
}

const plannedFor = (existing) => {
  const steps = load("install.js").run.filter((step) => {
    const text = flatten(step.params)
    return (step.method === "fs.rm" || text.includes("git clone")) && evaluateWhen(step, existing)
  })
  return steps.map((step) => (step.method === "fs.rm" ? `rm ${step.params.path}` : "clone"))
}

test("install.js heals a partial clone: no api.py means remove app and clone again", () => {
  assert.deepEqual(plannedFor(["app", "app/.git", "app/env"]), ["rm app", "clone"])
  assert.deepEqual(plannedFor(["app", "app/api.py"]), ["rm app", "clone"])
  assert.deepEqual(plannedFor(["app", "app/requirements.txt"]), ["rm app", "clone"])
})

test("install.js clones into the empty app folder Pinokio creates", () => {
  assert.deepEqual(plannedFor(["app"]), ["rm app", "clone"])
  assert.deepEqual(plannedFor([]), ["clone"])
})

test("install.js leaves a complete app alone", () => {
  assert.deepEqual(plannedFor(["app", "app/.git", "app/api.py", "app/requirements.txt", "app/env"]), [])
})

test("install.js clones shallow into app and builds the frontend", () => {
  const steps = load("install.js").run
  const clone = steps.find((step) => flatten(step.params).includes("git clone"))
  assert.equal(clone.params.message, "git clone --depth 1 --branch v0.0.16 https://github.com/PotionUI/PotionUI.git app")
  const build = steps.find((step) => step.params && step.params.path === "app/frontend")
  assert.deepEqual(build.params.message, ["npm install", "npm run build"])
})

const documentedHelpers = new Set([
  "exists", "running", "which", "platform", "gpu", "gpus", "arch", "port", "path", "cwd",
  "input", "args", "local", "os", "envs", "self", "uri", "current", "next"
])

const templateExpressions = (value, found = []) => {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) found.push(match[1])
  } else if (Array.isArray(value)) {
    value.forEach((item) => templateExpressions(item, found))
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => templateExpressions(item, found))
  }
  return found
}

const rootIdentifiers = (expression) =>
  expression
    .replace(/'[^']*'|"[^"]*"/g, "''")
    .match(/(?<![\w.$])[A-Za-z_$][\w$]*/g) || []

test("template expressions use only documented Pinokio helpers", async () => {
  for (const name of scripts) {
    for (const expression of templateExpressions(await scriptOf(name))) {
      for (const identifier of rootIdentifiers(expression)) {
        assert.ok(documentedHelpers.has(identifier), `${name}: {{${expression}}} uses ${identifier}`)
      }
    }
  }
})

test("the helper check rejects kernel.exists", () => {
  assert.deepEqual(rootIdentifiers("!kernel.exists(cwd, 'app', '.git')"), ["kernel", "cwd"])
  assert.ok(!documentedHelpers.has("kernel"))
})

const infoFor = ({ existing = [], runningScripts = [], url } = {}) => ({
  exists: (relative) => existing.includes(relative),
  running: (file) => runningScripts.includes(file),
  local: () => (url ? { url } : {})
})

const texts = (items) => items.map((item) => item.text)
const installed = ["app/env", "app/frontend/build"]
const menuFor = (state) => load("pinokio.js").menu({}, infoFor(state))

test("menu offers Install when nothing is installed", async () => {
  const menu = await menuFor()
  assert.deepEqual(texts(menu), ["Install"])
  assert.strictEqual(menu[0].default, true)
})

test("menu offers Start, Update, Install and Reset when installed and idle", async () => {
  const menu = await menuFor({ existing: installed })
  assert.deepEqual(texts(menu), ["Start", "Update", "Install", "Reset"])
  assert.equal(menu[0].href, "start.js")
  assert.strictEqual(menu[0].default, true)
})

test("menu shows Open Web UI and Terminal while running", async () => {
  const menu = await menuFor({ existing: installed, runningScripts: ["start.js"], url: "http://127.0.0.1:41234" })
  assert.deepEqual(texts(menu), ["Open Web UI", "Terminal"])
  assert.equal(menu[0].href, "http://127.0.0.1:41234")
})

test("menu shows progress while installing and before the URL is known", async () => {
  assert.deepEqual(texts(await menuFor({ runningScripts: ["install.js"] })), ["Installing"])
  assert.deepEqual(texts(await menuFor({ existing: installed, runningScripts: ["start.js"] })), ["Terminal"])
})

test("pinokio.js declares title, description, icon and version", () => {
  const meta = load("pinokio.js")
  assert.equal(meta.title, "PotionUI")
  assert.ok(meta.description.length > 10)
  assert.ok(meta.version)
  assert.ok(fs.existsSync(path.join(root, meta.icon)))
})

test("pinokio.json carries the display metadata", () => {
  const meta = JSON.parse(fs.readFileSync(path.join(root, "pinokio.json"), "utf8"))
  assert.equal(meta.title, "PotionUI")
  assert.ok(meta.description)
  assert.ok(fs.existsSync(path.join(root, meta.icon)))
})

test(".gitignore covers Pinokio-generated and local files", () => {
  const lines = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split("\n")
  for (const entry of ["/app/", "/env/", "/data/", "/logs/", "/cache/", "ENVIRONMENT", "/CLAUDE.md", "/AGENTS.md", "/GEMINI.md", "/QWEN.md", "/.clinerules", "/.cursorrules", "/.windsurfrules", "/.geminiignore"]) {
    assert.ok(lines.includes(entry), entry)
  }
})

const readPng = (file) => {
  const zlib = require("node:zlib")
  const buffer = fs.readFileSync(file)
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const depth = buffer[24]
  const colorType = buffer[25]
  const interlace = buffer[28]
  const chunks = []
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    if (buffer.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(buffer.subarray(offset + 8, offset + 8 + length))
    }
    offset += length + 12
  }
  return { width, height, depth, colorType, interlace, raw: zlib.inflateSync(Buffer.concat(chunks)) }
}

const unfilter = ({ width, height, raw }, channels) => {
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dl = Math.abs(estimate - left)
        const du = Math.abs(estimate - up)
        const dul = Math.abs(estimate - upLeft)
        predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft
      }
      pixels[y * stride + x] = (value + predictor) & 255
    }
  }
  return pixels
}

test("icon.png is 512x512 with opaque corners", () => {
  const png = readPng(path.join(root, "icon.png"))
  assert.equal(png.width, 512)
  assert.equal(png.height, 512)
  assert.equal(png.depth, 8)
  assert.equal(png.interlace, 0)
  assert.ok([2, 6].includes(png.colorType), `color type ${png.colorType}`)
  if (png.colorType === 2) return
  const pixels = unfilter(png, 4)
  const alphaAt = (x, y) => pixels[(y * png.width + x) * 4 + 3]
  for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]]) {
    assert.equal(alphaAt(x, y), 255, `corner ${x},${y}`)
  }
})

const APP_VERSION = "0.0.16"

test("the app version is pinned to one tag across install, update, metadata and README", () => {
  const tag = `v${APP_VERSION}`
  const clone = load("install.js").run.find((step) => flatten(step.params).includes("git clone"))
  assert.ok(clone.params.message.includes(`--branch ${tag} `))
  const messages = load("update.js").run.map((step) => step.params.message)
  assert.ok(messages.includes(`git fetch --depth 1 origin tag ${tag}`))
  assert.ok(messages.includes(`git checkout ${tag}`))
  assert.ok(!messages.includes("git pull"))
  const json = JSON.parse(fs.readFileSync(path.join(root, "pinokio.json"), "utf8"))
  assert.equal(load("pinokio.js").version, "7.0")
  for (const description of [load("pinokio.js").description, json.description]) {
    assert.ok(description.startsWith(`PotionUI ${APP_VERSION}:`))
  }
  assert.ok(fs.readFileSync(path.join(root, "README.md"), "utf8").includes(`PotionUI ${APP_VERSION}`))
})

test("requirements are stated in both descriptions and the README", () => {
  const json = JSON.parse(fs.readFileSync(path.join(root, "pinokio.json"), "utf8"))
  assert.equal(load("pinokio.js").description, json.description)
  for (const needle of ["Windows or Linux", "NVIDIA", "580", "8 GB VRAM", "16 GB RAM", "remote-only"]) {
    assert.ok(json.description.includes(needle), needle)
  }
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8")
  assert.ok(readme.includes("## Requirements"))
  for (const needle of ["driver 580", "8 GB VRAM", "16 GB system RAM", "32 GB RAM", "remote worker or a cloud backend"]) {
    assert.ok(readme.includes(needle), needle)
  }
})

test("install.js warns non-NVIDIA machines before the clone and the heavy install", () => {
  const steps = load("install.js").run
  const warnIndex = steps.findIndex((step) => step.method === "notify" && String(step.when).includes("!== 'nvidia'") && step.params.html.includes("remote worker or a cloud backend"))
  assert.ok(warnIndex >= 0)
  const warning = steps[warnIndex]
  assert.equal(warning.when, "{{gpu !== 'nvidia'}}")
  assert.ok(warning.params.html.includes("Windows or Linux with an NVIDIA GPU"))
  const firstHeavy = steps.findIndex((step) => step.method === "shell.run" || step.method === "fs.rm")
  assert.ok(warnIndex < firstHeavy)
  for (const expression of templateExpressions(warning)) {
    for (const identifier of rootIdentifiers(expression)) assert.ok(documentedHelpers.has(identifier), identifier)
  }
})
