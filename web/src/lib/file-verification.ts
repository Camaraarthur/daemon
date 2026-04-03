/**
 * File Verification — traces a local file path to the URL where it is served.
 *
 * Reads the Cloudflare tunnel config to map domains → localhost ports,
 * then reads systemd service files to map ports → working directories.
 * This prevents the common mistake of editing a file that isn't actually
 * being served at the expected URL.
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, relative } from 'path'

export interface FileVerificationResult {
  file_path: string
  served_at_url: string | null
  service_name: string | null
  verified: boolean
  warning?: string
}

interface IngressRule {
  hostname: string
  port: number
}

interface ServiceMapping {
  name: string
  port: number
  workingDirectory: string
}

const CLOUDFLARE_CONFIG = '/home/arthur/.cloudflared/config-arturito.yml'
const SYSTEMD_DIR = '/etc/systemd/system'

// Known port-to-directory mappings as a fallback / supplement to systemd parsing.
// These cover services that use Docker, are configured inline, or don't have
// straightforward systemd units.
const KNOWN_MAPPINGS: ServiceMapping[] = [
  { name: 'daemon-web', port: 4800, workingDirectory: '/home/arthur/daemon/web' },
  { name: 'press-archiver', port: 4750, workingDirectory: '/home/arthur/press-archiver' },
  { name: 'gis-backend', port: 4760, workingDirectory: '/home/arthur/gis/backend' },
  { name: 'gis-frontend', port: 4761, workingDirectory: '/home/arthur/gis/frontend' },
  { name: 'mirror', port: 3003, workingDirectory: '/home/arthur/mirror' },
  { name: 'arturito-prod', port: 4710, workingDirectory: '/home/arthur/arturito' },
  { name: 'arturito-dev', port: 4715, workingDirectory: '/home/arthur/arturito' },
  { name: 'arturito-bd-dev', port: 4720, workingDirectory: '/home/arthur/arturito-bd-dev' },
  { name: 'arturito-bd-stable', port: 3002, workingDirectory: '/home/arthur/arturito-bd-stable' },
  { name: 'comp-arturito', port: 4730, workingDirectory: '/home/arthur/comp-arturito' },
  { name: 'cabinet', port: 4770, workingDirectory: '/home/arthur/cabinet' },
  { name: 'beat', port: 4741, workingDirectory: '/home/arthur/beat' },
  { name: 'immich', port: 2283, workingDirectory: '/home/arthur/immich' },
]

/**
 * Parse the Cloudflare tunnel config to extract hostname → port mappings.
 */
function parseCloudflareConfig(): IngressRule[] {
  try {
    const raw = readFileSync(CLOUDFLARE_CONFIG, 'utf-8')
    const rules: IngressRule[] = []

    // Simple YAML parser for the ingress block — avoids a yaml dependency
    const lines = raw.split('\n')
    let inIngress = false
    let currentHostname: string | null = null

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed === 'ingress:') {
        inIngress = true
        continue
      }

      if (!inIngress) continue

      // Match hostname line: - hostname: example.com
      const hostnameMatch = trimmed.match(/^-\s*hostname:\s*["']?([^"'\s]+)["']?/)
      if (hostnameMatch) {
        currentHostname = hostnameMatch[1]
        continue
      }

      // Match service line: service: http://localhost:PORT
      const serviceMatch = trimmed.match(/service:\s*http:\/\/localhost:(\d+)/)
      if (serviceMatch && currentHostname) {
        rules.push({
          hostname: currentHostname,
          port: parseInt(serviceMatch[1], 10),
        })
        currentHostname = null
        continue
      }

      // Catch-all rule (no hostname)
      if (trimmed.startsWith('- service:') && !currentHostname) {
        continue
      }
    }

    return rules
  } catch {
    return []
  }
}

/**
 * Parse systemd service files to extract port → working directory mappings.
 * Supplements the KNOWN_MAPPINGS with any additional services found.
 */
function parseSystemdServices(): ServiceMapping[] {
  const mappings = [...KNOWN_MAPPINGS]
  const knownPorts = new Set(KNOWN_MAPPINGS.map(m => m.port))

  try {
    const files = readdirSync(SYSTEMD_DIR).filter(f => f.endsWith('.service'))

    for (const file of files) {
      try {
        const content = readFileSync(`${SYSTEMD_DIR}/${file}`, 'utf-8')

        // Extract WorkingDirectory
        const wdMatch = content.match(/WorkingDirectory=(.+)/)
        if (!wdMatch) continue

        const workDir = wdMatch[1].trim()

        // Extract port from ExecStart or Environment=PORT=
        let port: number | null = null

        const portEnvMatch = content.match(/Environment=PORT=(\d+)/)
        if (portEnvMatch) {
          port = parseInt(portEnvMatch[1], 10)
        }

        if (!port) {
          const execPortMatch = content.match(/--port\s+(\d+)/)
          if (execPortMatch) {
            port = parseInt(execPortMatch[1], 10)
          }
        }

        if (!port) {
          const bindMatch = content.match(/:(\d{4,5})/)
          if (bindMatch) {
            port = parseInt(bindMatch[1], 10)
          }
        }

        if (port && !knownPorts.has(port)) {
          const name = file.replace('.service', '')
          mappings.push({ name, port, workingDirectory: workDir })
          knownPorts.add(port)
        }
      } catch {
        // Skip unreadable service files
      }
    }
  } catch {
    // systemd dir not accessible
  }

  return mappings
}

/**
 * Given a file path being edited, trace it to the URL where it is served.
 *
 * Returns verification details including the served URL, service name,
 * and whether the file is confirmed to be in the correct serving directory.
 */
export function verifyFile(filePath: string): FileVerificationResult {
  const absPath = resolve(filePath)
  const ingressRules = parseCloudflareConfig()
  const serviceMappings = parseSystemdServices()

  // Find which service's working directory contains this file
  let matchedService: ServiceMapping | null = null
  let bestMatchLength = 0

  for (const svc of serviceMappings) {
    const svcDir = resolve(svc.workingDirectory)
    // Check if file is under this service's directory (longest prefix match)
    if (absPath.startsWith(svcDir + '/') || absPath === svcDir) {
      if (svcDir.length > bestMatchLength) {
        matchedService = svc
        bestMatchLength = svcDir.length
      }
    }
  }

  if (!matchedService) {
    return {
      file_path: absPath,
      served_at_url: null,
      service_name: null,
      verified: false,
      warning: 'This file is NOT in any known service directory. It may not be served at any URL.',
    }
  }

  // Find hostnames mapped to this service's port
  const hostnames = ingressRules
    .filter(r => r.port === matchedService!.port)
    .map(r => r.hostname)

  if (hostnames.length === 0) {
    return {
      file_path: absPath,
      served_at_url: null,
      service_name: matchedService.name,
      verified: false,
      warning: `File is in service '${matchedService.name}' (port ${matchedService.port}) but no Cloudflare tunnel routes to this port.`,
    }
  }

  // Build the primary served URL (prefer non-wildcard, non-.call.partners domains)
  const primaryHostname = hostnames.find(h => !h.includes('*') && !h.includes('call.partners'))
    || hostnames.find(h => !h.includes('*'))
    || hostnames[0]

  const relativePath = relative(resolve(matchedService.workingDirectory), absPath)

  return {
    file_path: absPath,
    served_at_url: `https://${primaryHostname}`,
    service_name: matchedService.name,
    verified: true,
  }
}

/**
 * Check if two file paths resolve to the same directory tree.
 * Useful for verifying you're editing the file that's actually deployed.
 */
export function isSameDeployment(editPath: string, servingDir: string): boolean {
  const absEdit = resolve(editPath)
  const absServe = resolve(servingDir)
  return absEdit.startsWith(absServe + '/') || absEdit === absServe
}

/**
 * Get all known domain → service mappings for display/debugging.
 */
export function listAllMappings(): Array<{ hostname: string; port: number; service: string; directory: string }> {
  const ingressRules = parseCloudflareConfig()
  const serviceMappings = parseSystemdServices()

  return ingressRules
    .filter(r => !r.hostname.includes('*'))
    .map(r => {
      const svc = serviceMappings.find(s => s.port === r.port)
      return {
        hostname: r.hostname,
        port: r.port,
        service: svc?.name || '(unknown)',
        directory: svc?.workingDirectory || '(unknown)',
      }
    })
}
