import { defineConfig, devices } from '@playwright/test'

// Runs against the compose stack: `docker compose up -d` first. E2E_URL overrides the target.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 860 },
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 860 },
      // headless WebGL2 via SwiftShader
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  }],
})
