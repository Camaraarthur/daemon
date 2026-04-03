/**
 * Artifact Verification — confirms that build/deploy changes are actually live.
 *
 * After a build or deploy operation, this module verifies the artifact
 * was updated. Prevents the "BUILD SUCCESSFUL but nothing changed" trap.
 */

import { exec } from 'child_process'
import { stat } from 'fs/promises'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface VerificationResult {
  verified: boolean
  method: string
  details: string
}

/**
 * Verify a web endpoint contains expected content after deploy.
 *
 * Curls the URL and checks that the response body contains the expected
 * string or matches the expected pattern.
 */
export async function verifyWeb(opts: {
  url: string
  expect: string | RegExp
  timeoutMs?: number
}): Promise<VerificationResult> {
  const { url, expect, timeoutMs = 10000 } = opts
  const timeoutSec = Math.ceil(timeoutMs / 1000)

  try {
    const { stdout } = await execAsync(
      `curl -sS --max-time ${timeoutSec} -L ${JSON.stringify(url)}`,
      { timeout: timeoutMs + 2000, maxBuffer: 2 * 1024 * 1024 },
    )

    const matches = typeof expect === 'string'
      ? stdout.includes(expect)
      : expect.test(stdout)

    if (matches) {
      return {
        verified: true,
        method: `curl ${url}`,
        details: `Response contains expected content (${typeof expect === 'string' ? `"${expect.slice(0, 60)}"` : expect.toString()}).`,
      }
    }

    // Provide helpful context about what we did find
    const snippet = stdout.slice(0, 200).replace(/\n/g, ' ')
    return {
      verified: false,
      method: `curl ${url}`,
      details: `Response does NOT contain expected content. Got: "${snippet}..."`,
    }
  } catch (err: any) {
    return {
      verified: false,
      method: `curl ${url}`,
      details: `Failed to reach URL: ${err.message}`,
    }
  }
}

/**
 * Verify a file was recently modified (e.g., APK build output).
 *
 * Checks that the file's mtime is newer than the given threshold.
 * Default threshold: 5 minutes ago.
 */
export async function verifyFileUpdated(opts: {
  filePath: string
  maxAgeMs?: number
}): Promise<VerificationResult> {
  const { filePath, maxAgeMs = 5 * 60 * 1000 } = opts

  try {
    const info = await stat(filePath)
    const ageMs = Date.now() - info.mtimeMs
    const ageStr = ageMs < 60000
      ? `${Math.round(ageMs / 1000)}s ago`
      : `${Math.round(ageMs / 60000)}m ago`

    if (ageMs <= maxAgeMs) {
      return {
        verified: true,
        method: `stat ${filePath}`,
        details: `File was modified ${ageStr} (${(info.size / 1024).toFixed(0)} KB).`,
      }
    }

    return {
      verified: false,
      method: `stat ${filePath}`,
      details: `File was last modified ${ageStr}, which is older than the ${Math.round(maxAgeMs / 60000)}m threshold. The build may not have produced new output.`,
    }
  } catch (err: any) {
    return {
      verified: false,
      method: `stat ${filePath}`,
      details: `File does not exist or is not accessible: ${err.message}`,
    }
  }
}

/**
 * Verify a systemd service is running and healthy after restart.
 */
export async function verifyService(opts: {
  serviceName: string
  expectActive?: boolean
}): Promise<VerificationResult> {
  const { serviceName, expectActive = true } = opts

  try {
    const { stdout } = await execAsync(
      `systemctl status ${serviceName} 2>&1`,
      { timeout: 10000 },
    )

    const isActive = /Active:\s+active\s+\(running\)/.test(stdout)
    const pidMatch = stdout.match(/Main PID:\s+(\d+)/)
    const uptimeMatch = stdout.match(/Active:.*;\s+(.+?)$\s/m)

    if (isActive === expectActive) {
      return {
        verified: true,
        method: `systemctl status ${serviceName}`,
        details: isActive
          ? `Service is active (PID ${pidMatch?.[1] || 'unknown'}, up ${uptimeMatch?.[1]?.trim() || 'recently'}).`
          : `Service is stopped as expected.`,
      }
    }

    return {
      verified: false,
      method: `systemctl status ${serviceName}`,
      details: expectActive
        ? `Service is NOT active. Expected it to be running.`
        : `Service is still running. Expected it to be stopped.`,
    }
  } catch (err: any) {
    // systemctl status returns non-zero for stopped services
    if (!expectActive && err.stdout?.includes('inactive')) {
      return {
        verified: true,
        method: `systemctl status ${serviceName}`,
        details: 'Service is inactive (stopped) as expected.',
      }
    }

    return {
      verified: false,
      method: `systemctl status ${serviceName}`,
      details: `Failed to check service: ${err.message}`,
    }
  }
}

/**
 * Verify that an APK contains expected content (class names, resources, etc.).
 *
 * Uses standard tools (unzip, strings) to inspect the APK without
 * requiring Android SDK tools.
 */
export async function verifyApk(opts: {
  apkPath: string
  expectStrings?: string[]
  expectFiles?: string[]
}): Promise<VerificationResult> {
  const { apkPath, expectStrings = [], expectFiles = [] } = opts
  const failures: string[] = []

  // Check APK was recently built
  const fileCheck = await verifyFileUpdated({ filePath: apkPath })
  if (!fileCheck.verified) {
    return {
      verified: false,
      method: `APK inspection: ${apkPath}`,
      details: `APK file issue: ${fileCheck.details}`,
    }
  }

  // Check for expected files inside the APK
  if (expectFiles.length > 0) {
    try {
      const { stdout } = await execAsync(
        `unzip -l ${JSON.stringify(apkPath)}`,
        { timeout: 10000, maxBuffer: 1024 * 1024 },
      )
      for (const f of expectFiles) {
        if (!stdout.includes(f)) {
          failures.push(`Missing file in APK: ${f}`)
        }
      }
    } catch (err: any) {
      failures.push(`Could not list APK contents: ${err.message}`)
    }
  }

  // Check for expected strings in DEX files
  if (expectStrings.length > 0) {
    try {
      const { stdout } = await execAsync(
        `unzip -p ${JSON.stringify(apkPath)} "*.dex" | strings`,
        { timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
      )
      for (const s of expectStrings) {
        if (!stdout.includes(s)) {
          failures.push(`String not found in DEX: "${s}"`)
        }
      }
    } catch (err: any) {
      failures.push(`Could not inspect DEX files: ${err.message}`)
    }
  }

  if (failures.length === 0) {
    return {
      verified: true,
      method: `APK inspection: ${apkPath}`,
      details: `APK is fresh (${fileCheck.details}) and contains all expected content.`,
    }
  }

  return {
    verified: false,
    method: `APK inspection: ${apkPath}`,
    details: failures.join('; '),
  }
}

/**
 * Verify a Docker container is running.
 */
export async function verifyContainer(opts: {
  containerName: string
}): Promise<VerificationResult> {
  const { containerName } = opts

  try {
    const { stdout } = await execAsync(
      `docker inspect --format='{{.State.Status}}' ${containerName}`,
      { timeout: 5000 },
    )

    const status = stdout.trim().replace(/'/g, '')
    if (status === 'running') {
      return {
        verified: true,
        method: `docker inspect ${containerName}`,
        details: `Container '${containerName}' is running.`,
      }
    }

    return {
      verified: false,
      method: `docker inspect ${containerName}`,
      details: `Container '${containerName}' status is '${status}', expected 'running'.`,
    }
  } catch (err: any) {
    return {
      verified: false,
      method: `docker inspect ${containerName}`,
      details: `Container '${containerName}' not found or Docker not accessible: ${err.message}`,
    }
  }
}
