const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const load = (name) => require(path.join(root, name))
const scripts = ["install.js", "start.js", "update.js", "reset.js"]

const parseEvent = (source) => {
  const match = source.match(/^\/(.*)\/([a-z]*)$/)
  assert.ok(match, `event is not a /regex/ literal: ${source}`)
  return new RegExp(match[1], match[2])
}

const flatten = (value) => JSON.stringify(value)

test("every script exports a run array of method steps", () => {
  for (const name of scripts) {
    const script = load(name)
    assert.ok(Array.isArray(script.run) && script.run.length > 0, `${name}: run`)
    for (const step of script.run) {
      assert.equal(typeof step.method, "string", `${name}: method`)
    }
  }
})

test("only start.js is a daemon", () => {
  assert.strictEqual(load("start.js").daemon, true)
  for (const name of ["install.js", "update.js", "reset.js"]) {
    assert.notStrictEqual(load(name).daemon, true, name)
  }
})

test("start.js runs the backend in a shell and keeps it alive on the URL line", () => {
  const [launch, remember] = load("start.js").run
  assert.equal(launch.method, "shell.run")
  assert.ok(launch.params.message.includes("python api.py"))
  assert.equal(launch.params.path, "app")
  assert.equal(launch.params.on.length, 1)
  assert.strictEqual(launch.params.on[0].done, true)
  assert.equal(remember.method, "local.set")
  assert.equal(remember.params.url, "{{input.event[1]}}")
})

test("start.js URL regex matches PotionUI's real startup line", () => {
  const regex = parseEvent(load("start.js").run[0].params.on[0].event)
  const lines = [
    "Uvicorn running on http://127.0.0.1:26730 (Press CTRL+C to quit)",
    "Uvicorn running on \u001b[1mhttp://127.0.0.1:26730\u001b[0m (Press CTRL+C to quit)",
    "           INFO     Uvicorn running on http://127.0.0.1:26730       server.py:222"
  ]
  for (const line of lines) {
    const match = line.match(regex)
    assert.ok(match, line)
    assert.equal(match[1], "http://127.0.0.1:26730")
  }
})

test("start.js URL regex ignores other URLs in the log", () => {
  const regex = parseEvent(load("start.js").run[0].params.on[0].event)
  assert.equal(regex.test("Ollama at http://localhost:11434"), false)
  assert.equal(regex.test("GET http://127.0.0.1:26730/health 200"), false)
})

test("start.js keeps storage, database and models outside the app checkout", () => {
  const env = load("start.js").run[0].params.env
  for (const key of ["POTIONUI_STORAGE_PATH", "POTIONUI_DB_PATH", "POTIONUI_MODELS_DIR"]) {
    assert.match(env[key], /path\.resolve\(cwd, 'data'/, key)
  }
})

test("update.js never deletes anything and reruns install", () => {
  const update = load("update.js")
  assert.ok(!update.run.some((step) => step.method.startsWith("fs.")))
  assert.ok(update.run.some((step) => step.params.message === "git pull" && step.params.path === "app"))
  assert.ok(update.run.some((step) => step.method === "script.start" && step.params.uri === "install.js"))
})

test("reset.js removes only the environment and frontend artefacts", () => {
  const removals = load("reset.js").run.filter((step) => step.method === "fs.rm")
  const removed = removals.map((step) => step.params.path)
  assert.deepEqual(removed.sort(), ["app/frontend/build", "app/frontend/node_modules", "env"])
  assert.ok(!/data|storage|models/.test(flatten(removals)))
})

test("no script outside reset.js deletes files", () => {
  for (const name of ["install.js", "start.js", "update.js"]) {
    assert.ok(!/fs\.rm|rm -rf|rmdir|del /.test(flatten(load(name))), name)
  }
})

test("install.js branches pip installs on gpu and platform", () => {
  const steps = load("install.js").run.filter((step) => step.method === "shell.run" && step.when)
  const pip = steps.filter((step) => String(step.params.message).includes("pip install -r"))
  assert.equal(pip.length, 3)
  const nvidiaWindows = pip.find((step) => step.when.includes("win32") && step.when.includes("=== 'nvidia'"))
  assert.ok(nvidiaWindows.params.message.includes("constraints.txt"))
  assert.ok(nvidiaWindows.params.message.includes("whl/cu130"))
  const nvidiaPosix = pip.find((step) => step.when.includes("!== 'win32'"))
  assert.ok(nvidiaPosix.params.message.includes("constraints.txt"))
  assert.ok(!nvidiaPosix.params.message.includes("--extra-index-url"))
  const cpu = pip.find((step) => step.when === "{{gpu !== 'nvidia'}}")
  assert.ok(cpu.params.message.includes("requirements-cpu.txt"))
  assert.ok(!cpu.params.message.includes("constraints.txt"))
})

test("install.js clones once, builds the frontend and uses python 3.12", () => {
  const steps = load("install.js").run
  assert.ok(steps[0].when.includes("kernel.exists"))
  assert.ok(steps[0].params.message.startsWith("git clone https://github.com/PotionUI/PotionUI.git"))
  assert.ok(steps.some((step) => step.params && step.params.conda && step.params.conda.python === "python=3.12"))
  const build = steps.find((step) => step.params && step.params.path === "app/frontend")
  assert.deepEqual(build.params.message, ["npm install", "npm run build"])
})

const kernelFor = ({ existing = [], runningScripts = [], url } = {}) => ({
  exists: async (...chunks) => existing.includes(chunks.slice(1).join("/")),
  script: {
    running: (_dir, file) => runningScripts.includes(file),
    local: () => (url ? { url } : {})
  }
})

const texts = (items) => items.map((item) => item.text)
const installed = ["env", "app/frontend/build"]

test("menu offers Install when nothing is installed", async () => {
  assert.deepEqual(texts(await load("pinokio.js").menu(kernelFor())), ["Install"])
})

test("menu offers Start, Update and Reset when installed and idle", async () => {
  const menu = await load("pinokio.js").menu(kernelFor({ existing: installed }))
  assert.deepEqual(texts(menu), ["Start", "Update", "Reset"])
  assert.equal(menu[0].href, "start.js")
})

test("menu shows Open Web UI and Terminal while running", async () => {
  const menu = await load("pinokio.js").menu(
    kernelFor({ existing: installed, runningScripts: ["start.js"], url: "http://127.0.0.1:26730" })
  )
  assert.deepEqual(texts(menu), ["Open Web UI", "Terminal"])
  assert.equal(menu[0].href, "http://127.0.0.1:26730")
})

test("menu shows progress while installing and before the URL is known", async () => {
  assert.deepEqual(texts(await load("pinokio.js").menu(kernelFor({ runningScripts: ["install.js"] }))), ["Installing"])
  assert.deepEqual(
    texts(await load("pinokio.js").menu(kernelFor({ existing: installed, runningScripts: ["start.js"] }))),
    ["Starting"]
  )
})

test("pinokio.js declares title, description, icon and version", () => {
  const meta = load("pinokio.js")
  assert.equal(meta.title, "PotionUI")
  assert.ok(meta.description.length > 10)
  assert.ok(meta.version)
  assert.ok(fs.existsSync(path.join(root, meta.icon)))
})
