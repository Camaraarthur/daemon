import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Try multiple possible ESP32 IPs
const ESP32_CANDIDATES = [
  '10.235.24.', // Pixel hotspot
  '192.168.43.', // Android hotspot alt
  '192.168.49.', // Android hotspot alt2
  '192.168.1.',  // Freebox
]

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;
  // Try to reach ESP32 via MSI as bridge
  try {
    const { stdout } = await execFileAsync('ssh', [
      '-o', 'ConnectTimeout=5', 'msi',
      'python', '-c',
      `import socket,json
for subnet in ['10.235.24.','192.168.43.','192.168.49.','192.168.1.']:
    for last in range(1,255):
        try:
            s=socket.socket()
            s.settimeout(0.5)
            s.connect((subnet+str(last),8268))
            s.send(b'GET / HTTP/1.0\\r\\n\\r\\n')
            import time;time.sleep(0.5)
            d=s.recv(4096).decode()
            s.close()
            if 'distance' in d:
                lines=d.split('\\r\\n\\r\\n',1)
                print(lines[-1] if len(lines)>1 else d)
                exit()
        except:pass
print('{"distance":-1,"error":"ESP32 not found"}')`
    ], { timeout: 30000 })

    return NextResponse.json(JSON.parse(stdout.trim()))
  } catch (e: any) {
    return NextResponse.json({ distance: -1, error: e?.message }, { status: 500 })
  }
}
