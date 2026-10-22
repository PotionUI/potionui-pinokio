const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")

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
  assert.ok(update.run.some((step) => step.params.message === "git checkout v0.0.17" && step.params.path === "app"))
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

const evaluateWhen = (step, existing, gpu = "nvidia", platform = "linux") => {
  if (!step.when) return true
  const expression = step.when.match(/^\{\{([\s\S]*)\}\}$/)[1]
  const exists = (relative) => existing.includes(relative)
  return Boolean(new Function("exists", "gpu", "platform", `return (${expression})`)(exists, gpu, platform))
}

const plannedFor = (existing) => {
  const steps = load("install.js").run.filter((step) => {
    const text = flatten(step.params)
    return (step.method === "fs.rm" || text.includes("git clone")) && evaluateWhen(step, existing)
  })
  return steps.map((step) => (step.method === "fs.rm" ? `rm ${step.params.path}` : "clone"))
}

const pipSteps = () => load("install.js").run.filter((step) => String(step.params.message).startsWith("uv pip install"))
const envInterpreter = { linux: "env/bin/python", darwin: "env/bin/python", win32: "env\\Scripts\\python.exe" }
const withEnv = ["app", "app/api.py", "app/requirements.txt", "app/env", "app/env/pyvenv.cfg"]

test("install.js declares the AI bundle and installs with uv into the env interpreter", () => {
  const install = load("install.js")
  assert.deepEqual(install.requires, { bundle: "ai" })
  assert.equal(pipSteps().length, 4)
  for (const step of pipSteps()) assert.equal(step.params.path, "app")
  assert.ok(!flatten(install).includes("pip install --upgrade"))
})

test("every gpu and platform combination selects exactly one pip step, aimed at that platform's env interpreter", () => {
  for (const gpu of ["nvidia", "amd"]) {
    for (const platform of ["linux", "darwin", "win32"]) {
      const selected = pipSteps().filter((step) => evaluateWhen(step, withEnv, gpu, platform))
      assert.equal(selected.length, 1, `${gpu} ${platform}`)
      assert.ok(selected[0].params.message.startsWith(`uv pip install --python ${envInterpreter[platform]} -r `), selected[0].params.message)
    }
  }
})

test("install.js branches pip installs on gpu and platform", () => {
  const messageFor = (gpu, platform) => pipSteps().find((step) => evaluateWhen(step, withEnv, gpu, platform)).params.message
  const nvidiaWindows = messageFor("nvidia", "win32")
  assert.ok(nvidiaWindows.includes("constraints.txt"))
  assert.ok(nvidiaWindows.includes("whl/cu130"))
  assert.ok(nvidiaWindows.includes("--index-strategy unsafe-best-match"))
  const nvidiaPosix = messageFor("nvidia", "linux")
  assert.ok(nvidiaPosix.includes("constraints.txt"))
  assert.ok(!nvidiaPosix.includes("--extra-index-url"))
  for (const platform of ["linux", "win32"]) {
    const cpu = messageFor("amd", platform)
    assert.ok(cpu.includes("requirements-cpu.txt"))
    assert.ok(cpu.includes("whl/cpu"))
    assert.ok(!cpu.includes("constraints.txt"))
  }
})

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
  assert.equal(clone.params.message, "git clone --depth 1 --branch v0.0.17 https://github.com/PotionUI/PotionUI.git app")
  const build = steps.find((step) => step.params && step.params.path === "app/frontend")
  assert.equal(build.params.message, "node ../../build-frontend.js")
  assert.ok(fs.existsSync(path.join(root, "build-frontend.js")))
})

test("build-frontend.js moves into the folder's real path before npm install and npm run build", () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "potionui-build-")))
  const log = path.join(sandbox, "calls.json")
  const preload = path.join(sandbox, "preload.js")
  fs.writeFileSync(preload, `
const fs = require("fs")
const childProcess = require("child_process")
const calls = []
const save = () => fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls))
fs.realpathSync.native = (value) => { calls.push(["realpath", value]); return "/Canonical/Pinokio/app/frontend" }
process.chdir = (value) => { calls.push(["chdir", value]); save() }
childProcess.execSync = (command, options) => { calls.push(["exec", command, options && options.stdio]); save() }
`)
  try {
    const result = spawnSync(process.execPath, ["--require", preload, path.join(root, "build-frontend.js")], {
      cwd: sandbox,
      encoding: "utf8",
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(log, "utf8")), [
      ["realpath", sandbox],
      ["chdir", "/Canonical/Pinokio/app/frontend"],
      ["exec", "npm install", "inherit"],
      ["exec", "npm run build", "inherit"],
    ])
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test("build-frontend.js fails the step when the build fails", () => {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "potionui-build-")))
  const bin = path.join(sandbox, "bin")
  fs.mkdirSync(bin)
  const fakeNpm = path.join(bin, "npm")
  fs.writeFileSync(fakeNpm, `#!/bin/sh\n[ "$1" = "run" ] && exit 3\nexit 0\n`)
  fs.chmodSync(fakeNpm, 0o755)
  try {
    const result = spawnSync(process.execPath, [path.join(root, "build-frontend.js")], {
      cwd: sandbox,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
    })
    assert.notEqual(result.status, 0)
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
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
const uvicornEntry = { linux: "app/env/bin/uvicorn", win32: "app/env/Scripts/uvicorn.exe" }
const installedOn = (platform) => ["app/env", "app/frontend/build", uvicornEntry[platform]]
const installed = installedOn("linux")
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

for (const platform of ["linux", "win32"]) {
  test(`menu offers Start when the ${platform} venv has its uvicorn entry point`, async () => {
    const menu = await menuFor({ existing: installedOn(platform) })
    assert.deepEqual(texts(menu), ["Start", "Update", "Install", "Reset"])
  })

  test(`menu offers Repair install, never Start, when the ${platform} venv and build exist without uvicorn`, async () => {
    const menu = await menuFor({ existing: installedOn(platform).slice(0, 2) })
    assert.deepEqual(texts(menu), ["Repair install"])
    assert.equal(menu[0].href, "install.js")
    assert.strictEqual(menu[0].default, true)
  })
}

test("menu does not accept the other platform's uvicorn path as proof of a working venv", async () => {
  assert.deepEqual(texts(await menuFor({ existing: ["app/env", "app/frontend/build", "app/env/Scripts/uvicorn"] })), ["Repair install"])
  assert.deepEqual(texts(await menuFor({ existing: ["app/env", "app/frontend/build", "app/env/bin/uvicorn.exe"] })), ["Repair install"])
})

test("menu offers Repair install for any half-finished install and plain Install for none", async () => {
  assert.deepEqual(texts(await menuFor({ existing: ["app/env"] })), ["Repair install"])
  assert.deepEqual(texts(await menuFor({ existing: ["app/frontend/build"] })), ["Repair install"])
  assert.deepEqual(texts(await menuFor({ existing: ["app/env", uvicornEntry.linux] })), ["Repair install"])
  assert.deepEqual(texts(await menuFor({ existing: ["app"] })), ["Install"])
  assert.deepEqual(texts(await menuFor()), ["Install"])
})

test("menu never shows Open Web UI or Terminal for a venv without uvicorn", async () => {
  const menu = await menuFor({ existing: ["app/env", "app/frontend/build"], runningScripts: ["start.js"], url: "http://127.0.0.1:41234" })
  assert.deepEqual(texts(menu), ["Repair install"])
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

const APP_VERSION = "0.0.17"

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

const marker = "app/env/.deps-verified"
const uvicornRelative = (platform) => ({ linux: "bin/uvicorn", win32: "Scripts/uvicorn.exe" })[platform]

const simulateInstall = ({ gpu = "nvidia", platform = "linux", existing = [], envVersion = "3.12", createVersion = "3.12", cloneOk = true, pipOk = true, buildOk = true } = {}) => {
  const files = new Set(existing)
  let env = files.has("app/env/pyvenv.cfg") ? { version: envVersion } : null
  const ran = []
  const notices = []
  const entry = `app/env/${uvicornRelative(platform)}`
  for (const step of load("install.js").run) {
    if (!evaluateWhen(step, [...files], gpu, platform)) continue
    const message = String(step.params.message)
    if (step.method === "fs.rm") {
      ran.push("remove")
      for (const file of [...files]) if (file === step.params.path || file.startsWith(`${step.params.path}/`)) files.delete(file)
      if (step.params.path === "app") env = null
    } else if (step.method === "notify") {
      ran.push("notify")
      notices.push(step.params.html)
    } else if (message.includes("git clone")) {
      ran.push("clone")
      if (cloneOk) ["app", "app/.git", "app/api.py", "app/requirements.txt"].forEach((file) => files.add(file))
    } else if (message.includes("shutil.rmtree('env'")) {
      ran.push("probe")
      if (!env || env.version !== "3.12") {
        for (const file of [...files]) if (file === "app/env" || file.startsWith("app/env/")) files.delete(file)
        env = null
      }
    } else if (message.startsWith("uv venv")) {
      ran.push("venv")
      assert.ok(message.includes("--python 3.12"), message)
      assert.ok(!env, "uv venv must not run over an existing env")
      if (createVersion) {
        ["app/env", "app/env/pyvenv.cfg"].forEach((file) => files.add(file))
        env = { version: createVersion }
      }
    } else if (message.startsWith("uv pip install")) {
      ran.push("pip")
      assert.ok(env, "pip needs an env")
      if (pipOk && env.version === "3.12") files.add(entry)
    } else if (message.includes("import uvicorn")) {
      ran.push("verify")
      files.delete(marker)
      if (env && env.version === "3.12" && files.has(entry)) files.add(marker)
    } else if (message.includes("conda install")) {
      ran.push("ffmpeg")
    } else if (step.params.path === "app/frontend") {
      ran.push("build")
      if (buildOk) files.add("app/frontend/build")
    } else {
      assert.fail(`unexpected step ${flatten(step)}`)
    }
  }
  return { ran, notices, files, env }
}

const reportsInstalled = (notices) => notices.some((html) => html.includes("Click Start") || html.includes("CPU-only build"))
const reportsFailure = (notices) => notices.some((html) => html.includes("click Install again"))
const completeRun = ["clone", "probe", "venv", "pip", "verify", "ffmpeg", "build", "notify"]
const withoutNotices = (ran) => ran.filter((name) => name !== "notify")

test("install.js verifies the env right after the pip step and before ffmpeg and the frontend build", () => {
  const steps = load("install.js").run
  const pip = steps.map((step, index) => (String(step.params.message).startsWith("uv pip install") ? index : -1)).filter((index) => index >= 0)
  const verify = steps.map((step, index) => (String(step.params.message).includes("import uvicorn, fastapi, torch") ? index : -1)).filter((index) => index >= 0)
  const ffmpeg = steps.findIndex((step) => String(step.params.message).includes("conda install"))
  const build = steps.findIndex((step) => step.params && step.params.path === "app/frontend")
  assert.equal(verify.length, 2)
  assert.ok(Math.min(...verify) > Math.max(...pip))
  assert.ok(Math.max(...verify) < ffmpeg && ffmpeg < build)
  for (const index of verify) {
    assert.equal(steps[index].params.path, "app")
    assert.ok(steps[index].params.message.includes("sys.version_info[:2] == (3, 12)"))
  }
})

test("install.js runs ffmpeg, the frontend build and the success notices only when the env verified", () => {
  const steps = load("install.js").run
  const ffmpeg = steps.findIndex((step) => String(step.params.message).includes("conda install"))
  for (const step of steps.slice(ffmpeg)) {
    const gated = step.when.includes(`exists('${marker}')`)
    const failure = step.when.includes(`!exists('${marker}')`)
    assert.ok(gated || failure, flatten(step))
  }
  const success = steps.filter((step) => step.method === "notify" && String(step.params.html).includes("Click Start"))
  assert.equal(success.length, 1)
  assert.ok(success[0].when.includes(`exists('${marker}')`) && !success[0].when.includes(`!exists('${marker}')`))
  assert.ok(success[0].when.includes("exists('app/frontend/build')"))
})

test("install.js creates the env with uv and an explicit Python 3.12 after dropping a wrong one, and never over an existing env", () => {
  const steps = load("install.js").run
  const create = steps.findIndex((step) => step.params.message === "uv venv --python 3.12 env")
  assert.ok(create >= 0)
  assert.equal(steps[create].params.path, "app")
  assert.ok(steps[create].when.includes("!exists('app/env/pyvenv.cfg')"))
  const drop = steps.map((step, index) => (String(step.params.message).includes("shutil.rmtree('env'") ? index : -1)).filter((index) => index >= 0)
  assert.equal(drop.length, 2)
  assert.ok(Math.max(...drop) < create)
  const firstPip = steps.findIndex((step) => String(step.params.message).startsWith("uv pip install"))
  assert.ok(create < firstPip)
  assert.ok(!/--clear|--allow-existing|--seed/.test(flatten(steps)))
  for (const index of drop) {
    assert.ok(steps[index].params.message.includes("sys.version_info[:2] == (3, 12)"))
    assert.ok(steps[index].params.message.includes(" || python -c "))
  }
})

test("install.js leaves Pinokio's venv handling out of every step so a wrong default Python cannot be picked up", () => {
  for (const step of load("install.js").run) {
    assert.ok(!("venv" in step.params) && !("venv_python" in step.params), flatten(step))
  }
})

test("install.js skips the pip steps when there is no env, so a failed clone or env creation installs nothing", () => {
  const pip = load("install.js").run.filter((step) => String(step.params.message).startsWith("uv pip install"))
  assert.equal(pip.length, 4)
  for (const step of pip) assert.ok(step.when.includes("exists('app/env/pyvenv.cfg')"), step.when)
  const clone = simulateInstall({ cloneOk: false })
  assert.deepEqual(clone.ran, ["clone", "notify"])
  assert.ok(reportsFailure(clone.notices) && !reportsInstalled(clone.notices))
  const noPython = simulateInstall({ createVersion: null })
  assert.deepEqual(noPython.ran, ["clone", "probe", "venv", "notify"])
  assert.ok(reportsFailure(noPython.notices) && !reportsInstalled(noPython.notices))
  assert.ok(!noPython.files.has("app/env"))
})

test("install.js rebuilds a Python 3.10 env with 3.12 and finishes", () => {
  const existing = ["app", "app/.git", "app/api.py", "app/requirements.txt", "app/env", "app/env/pyvenv.cfg", "app/frontend/build"]
  for (const platform of ["linux", "win32"]) {
    const run = simulateInstall({ existing, envVersion: "3.10", platform })
    assert.deepEqual(run.ran, ["probe", "venv", "pip", "verify", "ffmpeg", "build", "notify"], platform)
    assert.equal(run.env.version, "3.12")
    assert.ok(run.files.has(marker) && !reportsFailure(run.notices) && reportsInstalled(run.notices))
  }
})

test("install.js keeps a working Python 3.12 env and installs into it", () => {
  const existing = ["app", "app/.git", "app/api.py", "app/requirements.txt", "app/env", "app/env/pyvenv.cfg"]
  const run = simulateInstall({ existing })
  assert.deepEqual(run.ran, ["probe", "pip", "verify", "ffmpeg", "build", "notify"])
})

test("install.js stops after a failed pip step: no ffmpeg, no frontend build, no success notice", () => {
  for (const [gpu, platform] of [["nvidia", "linux"], ["nvidia", "win32"], ["none", "linux"], ["none", "win32"]]) {
    const { ran, notices, files } = simulateInstall({ gpu, platform, pipOk: false })
    assert.deepEqual(withoutNotices(ran), ["clone", "probe", "venv", "pip", "verify"], `${gpu} ${platform}`)
    assert.ok(reportsFailure(notices) && !reportsInstalled(notices), `${gpu} ${platform}`)
    assert.ok(!files.has(marker) && !files.has("app/frontend/build"))
  }
})

test("install.js on a repair run with a bare venv and a stale build fails loudly instead of reporting success", () => {
  const existing = ["app", "app/.git", "app/api.py", "app/requirements.txt", "app/env", "app/env/pyvenv.cfg", "app/frontend/build", marker]
  const { ran, notices } = simulateInstall({ existing, pipOk: false })
  assert.deepEqual(withoutNotices(ran), ["probe", "pip", "verify"])
  assert.ok(reportsFailure(notices) && !reportsInstalled(notices))
})

test("install.js completes the whole flow when every step works", () => {
  const nvidia = simulateInstall()
  assert.deepEqual(nvidia.ran, completeRun)
  assert.ok(nvidia.notices.some((html) => html.includes("Click Start")) && !reportsFailure(nvidia.notices))
  const cpu = simulateInstall({ gpu: "none" })
  assert.deepEqual(cpu.ran, ["notify", ...completeRun])
  assert.ok(cpu.notices.some((html) => html.includes("CPU-only build")) && !reportsFailure(cpu.notices))
  assert.deepEqual(simulateInstall({ platform: "win32" }).ran, completeRun)
})

test("install.js reports a failed frontend build and does not say the install is done", () => {
  const { ran, notices } = simulateInstall({ buildOk: false })
  assert.deepEqual(ran, completeRun)
  assert.equal(notices.length, 1)
  assert.ok(notices[0].includes("frontend build failed") && !reportsInstalled(notices))
})

const python = (() => {
  for (const name of ["python3", "python"]) {
    const probe = spawnSync(name, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" })
    if (probe.status === 0 && probe.stdout.trim() === "3") return name
  }
  return null
})()

const importable = ""
const missing = (name) => `raise ModuleNotFoundError("No module named '${name}'")\n`
const healthyModules = { uvicorn: importable, fastapi: importable, torch: importable }
const envFiles = ["app", "app/api.py", "app/requirements.txt", "app/env", "app/env/pyvenv.cfg"]

const withEnvFixture = ({ stubs = healthyModules, version = [3, 12], hasEnv = true, brokenEnv = false, stale = false }, body) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "potionui-env-"))
  try {
    const app = path.join(root, "app")
    const stubDir = path.join(root, "stubs")
    fs.mkdirSync(app)
    fs.mkdirSync(stubDir)
    if (hasEnv) {
      const created = spawnSync(python, ["-m", "venv", "--without-pip", path.join(app, "env")], { encoding: "utf8" })
      assert.equal(created.status, 0, created.stderr)
      if (brokenEnv) fs.rmSync(path.join(app, "env", process.platform === "win32" ? "Scripts" : "bin"), { recursive: true, force: true })
    }
    fs.writeFileSync(path.join(stubDir, "sitecustomize.py"), `import sys\nsys.version_info = (${version[0]}, ${version[1]}, 0, "final", 0)\n`, "utf8")
    for (const [name, text] of Object.entries(stubs)) fs.writeFileSync(path.join(stubDir, `${name}.py`), text, "utf8")
    if (stale) fs.writeFileSync(path.join(app, "env", ".deps-verified"), "")
    const run = (needle) => {
      const step = load("install.js").run.find((item) => String(item.params.message).includes(needle) && evaluateWhen(item, envFiles, "nvidia", process.platform))
      const command = step.params.message.replace(" || python -c ", ` || ${python} -c `)
      const result = spawnSync(command, { shell: true, cwd: app, env: { ...process.env, PYTHONPATH: stubDir }, encoding: "utf8" })
      return { status: result.status, output: `${result.stdout}${result.stderr}` }
    }
    return body({ app, run, markerFile: path.join(app, "env", ".deps-verified"), envDir: path.join(app, "env") })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test("the verify command writes the marker only when the env is Python 3.12 and uvicorn, fastapi and torch import", { skip: !python }, () => {
  withEnvFixture({}, ({ run, markerFile }) => {
    const result = run("import uvicorn")
    assert.equal(fs.existsSync(markerFile), true, result.output)
  })
  for (const absent of ["uvicorn", "fastapi", "torch"]) {
    withEnvFixture({ stubs: { ...healthyModules, [absent]: missing(absent) } }, ({ run, markerFile }) => {
      const result = run("import uvicorn")
      assert.equal(fs.existsSync(markerFile), false, absent)
      assert.ok(result.output.includes(`No module named '${absent}'`), result.output)
    })
  }
})

test("the verify command refuses a Python 3.10 env even when every package imports", { skip: !python }, () => {
  withEnvFixture({ version: [3, 10] }, ({ run, markerFile }) => {
    const result = run("import uvicorn")
    assert.equal(fs.existsSync(markerFile), false, result.output)
    assert.ok(result.output.includes("AssertionError"), result.output)
  })
})

test("the verify command removes a stale marker when the check fails", { skip: !python }, () => {
  withEnvFixture({ stubs: { ...healthyModules, uvicorn: missing("uvicorn") }, stale: true }, ({ run, markerFile }) => {
    run("import uvicorn")
    assert.equal(fs.existsSync(markerFile), false)
  })
  withEnvFixture({ version: [3, 10], stale: true }, ({ run, markerFile }) => {
    run("import uvicorn")
    assert.equal(fs.existsSync(markerFile), false)
  })
})

test("the env check keeps a Python 3.12 env and removes a 3.10, a broken or a missing one without failing", { skip: !python }, () => {
  withEnvFixture({}, ({ run, envDir }) => {
    const result = run("shutil.rmtree")
    assert.equal(fs.existsSync(envDir), true, result.output)
  })
  withEnvFixture({ version: [3, 10] }, ({ run, envDir }) => {
    const result = run("shutil.rmtree")
    assert.equal(result.status, 0, result.output)
    assert.equal(fs.existsSync(envDir), false)
  })
  withEnvFixture({ brokenEnv: true }, ({ run, envDir }) => {
    const result = run("shutil.rmtree")
    assert.equal(result.status, 0, result.output)
    assert.equal(fs.existsSync(envDir), false)
  })
  withEnvFixture({ hasEnv: false }, ({ run, envDir }) => {
    const result = run("shutil.rmtree")
    assert.equal(result.status, 0, result.output)
    assert.equal(fs.existsSync(envDir), false)
  })
})

const git = (cwd, args) => {
  const result = spawnSync("git", ["-c", "user.name=launcher-test", "-c", "user.email=launcher-test@example.com", ...args], { cwd, encoding: "utf8" })
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout.trim()
}

const buildUpdateFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "potionui-update-"))
  const origin = path.join(root, "origin")
  fs.mkdirSync(origin)
  git(origin, ["init", "-q"])
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(origin, file)), { recursive: true })
    fs.writeFileSync(path.join(origin, file), text, "utf8")
  }
  write(".gitignore", ".env\nenv/\nfrontend/build/\nfrontend/node_modules/\ncontent/presets/local/\n")
  write("api.py", "app\n")
  write("requirements.txt", "uvicorn\n")
  write("frontend/package-lock.json", "lock one\n")
  git(origin, ["add", "-A"])
  git(origin, ["commit", "-q", "-m", "one"])
  git(origin, ["tag", "v0.0.15"])
  write("frontend/package-lock.json", "lock two\n")
  write("content/presets/marketplace/new.yml", "new\n")
  git(origin, ["add", "-A"])
  git(origin, ["commit", "-q", "-m", "two"])
  git(origin, ["tag", "v0.0.17"])
  const target = git(origin, ["rev-parse", "v0.0.17^{commit}"])
  git(root, ["clone", "-q", "--depth", "1", "--branch", "v0.0.15", pathToFileURL(origin).href, "app"])
  const app = path.join(root, "app")
  const mine = {
    ".env": "SECRET=1\n",
    "env/bin/uvicorn": "entry\n",
    "frontend/build/index.html": "built\n",
    "frontend/node_modules/pkg/index.js": "module\n",
    "content/presets/local/mine.yml": "mine\n"
  }
  for (const [file, text] of Object.entries(mine)) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true })
    fs.writeFileSync(path.join(app, file), text, "utf8")
  }
  fs.writeFileSync(path.join(app, "frontend", "package-lock.json"), "lock one, rewritten by npm install\n", "utf8")
  return { root, app, target, mine, origin }
}

const runUpdateGit = (fixture, steps) => {
  const outcomes = []
  for (const step of steps) {
    const result = spawnSync(step.params.message, { shell: true, cwd: path.join(fixture.root, step.params.path), encoding: "utf8" })
    outcomes.push(result.status)
  }
  return outcomes
}

const updateGitSteps = () => load("update.js").run.filter((step) => step.method === "shell.run")

test("update.js switches to the pinned tag even though npm install rewrote the tracked lock file, and keeps every untracked or ignored file", () => {
  const fixture = buildUpdateFixture()
  try {
    assert.deepEqual(runUpdateGit(fixture, updateGitSteps()), [0, 0, 0])
    assert.equal(git(fixture.app, ["rev-parse", "HEAD"]), fixture.target)
    assert.equal(fs.readFileSync(path.join(fixture.app, "frontend", "package-lock.json"), "utf8"), "lock two\n")
    assert.ok(fs.existsSync(path.join(fixture.app, "content", "presets", "marketplace", "new.yml")))
    for (const [file, text] of Object.entries(fixture.mine)) {
      assert.equal(fs.readFileSync(path.join(fixture.app, file), "utf8"), text, file)
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("without the lock file restore the same checkout is refused, which is what update.js guards against", () => {
  const fixture = buildUpdateFixture()
  try {
    const steps = updateGitSteps().filter((step) => !step.params.message.includes("package-lock.json"))
    const [fetched, checkedOut] = runUpdateGit(fixture, steps)
    assert.equal(fetched, 0)
    assert.notEqual(checkedOut, 0)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("update.js restores only the lock file, never forces the checkout and still refuses to overwrite other edits", () => {
  const messages = updateGitSteps().map((step) => step.params.message)
  assert.deepEqual(messages, ["git checkout -- frontend/package-lock.json", "git fetch --depth 1 origin tag v0.0.17", "git checkout v0.0.17"])
  assert.ok(!/(^| )(-f|--force|reset|clean|stash)( |$)/.test(messages.join(" ")))
  const fixture = buildUpdateFixture()
  try {
    fs.writeFileSync(path.join(fixture.app, "api.py"), "edited by the user\n", "utf8")
    fs.writeFileSync(path.join(fixture.origin, "api.py"), "tag two\n", "utf8")
    git(fixture.origin, ["commit", "-q", "-am", "api"])
    git(fixture.origin, ["tag", "-f", "v0.0.17"])
    const outcomes = runUpdateGit(fixture, updateGitSteps())
    assert.notEqual(outcomes[2], 0)
    assert.equal(fs.readFileSync(path.join(fixture.app, "api.py"), "utf8"), "edited by the user\n")
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
})
