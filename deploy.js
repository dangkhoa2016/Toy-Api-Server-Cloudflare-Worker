#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
const isDryRun = process.argv.includes("--dry-run")

// =========================
// 🧠 UTILS
// =========================
function run(cmd) {
  execSync(cmd, { stdio: "inherit" })
}

function loadEnv(file) {
  const content = fs.readFileSync(file, "utf-8")
  const lines = content.split("\n")

  const env = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const [key, ...rest] = trimmed.split("=")
    env[key] = rest.join("=")
  }

  return env
}

function getBranch() {
  return execSync("git rev-parse --abbrev-ref HEAD")
    .toString()
    .trim()
}

// =========================
// 🔧 GENERATE CONFIG
// =========================
function generateWranglerToml(envVars) {
  const template = fs.readFileSync("wrangler.template.toml", "utf-8")

  const domain = envVars.DOMAIN
  const sub = envVars.API_SUBDOMAIN
  const kvPrefix = envVars.CLOUDFLARE_KV_PREFIX || "toy-api-server"

  const routeBlock = `
routes = [
  { pattern = "${sub}.${domain}/*", zone_name = "${domain}" }
]
`.trim()

  let output = template

  // Replace placeholders
  output = output.replace("__CORS_ORIGINS__", envVars.CORS_ORIGINS)
  output = output.replace("__KV_NAMESPACE_ID__", envVars.KV_NAMESPACE_ID)
  output = output.replace("__CLOUDFLARE_KV_PREFIX__", kvPrefix)

  // Inject routes
  output = output.replace(
    "# routes = []",
    routeBlock
  )

  fs.writeFileSync("wrangler.toml", output)

  console.log("✅ Generated wrangler.toml")
}

// =========================
// 🚀 MAIN
// =========================
function main() {
  const branch = getBranch()

  let envName = null
  let envFile = null

  if (["main", "master"].includes(branch)) {
    envName = "production"
    envFile = ".env.production"
  } else if (["staging", "stag"].includes(branch)) {
    envName = "staging"
    envFile = ".env.staging"
  } else {
    console.error(`❌ Invalid branch: ${branch}`)
    process.exit(1)
  }

  console.log(`🌿 Branch: ${branch}`)
  console.log(`🌍 Env: ${envName}`)

  if (envName === "production") {
    if (!fs.existsSync(".env.production")) {
      console.error("❌ Missing .env.production")
      process.exit(1)
    }

    const envVars = loadEnv(".env.production")

    // Validate required fields
    const required = [
      "DOMAIN",
      "API_SUBDOMAIN",
      "CORS_ORIGINS",
      "KV_NAMESPACE_ID"
    ]

    for (const key of required) {
      if (!envVars[key]) {
        console.error(`❌ Missing ${key} in .env.production`)
        process.exit(1)
      }
    }

    generateWranglerToml(envVars)
  }

  // Deploy
  console.log("🚀 Deploying...")
  const cmd = isDryRun
    ? `wrangler deploy --env ${envName} --dry-run`
    : `wrangler deploy --env ${envName}`

  run(cmd)

  console.log("✅ Done")
}

main()
