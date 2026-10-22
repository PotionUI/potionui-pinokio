const { realpathSync } = require("fs")
const { execSync } = require("child_process")

process.chdir(realpathSync.native(process.cwd()))
execSync("npm install", { stdio: "inherit" })
execSync("npm run build", { stdio: "inherit" })
