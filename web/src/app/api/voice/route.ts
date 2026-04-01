import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Voice API — returns Deepgram API key for client-side streaming STT.
 * The browser handles the WebSocket connection to Deepgram directly.
 * This avoids proxying audio through our server.
 */
export async function GET(req: NextRequest) {
  const authErr = requireAuth(req); if (authErr) return authErr;
  try {
    const vaultPath = join(process.env.HOME || '/home/arthur', '.secrets', 'vault.env')
    const vault = readFileSync(vaultPath, 'utf-8')
    let deepgramKey = ''
    for (const line of vault.split('\n')) {
      if (line.startsWith('DEEPGRAM_API_KEY=')) {
        deepgramKey = line.split('=')[1].trim().replace(/['"]/g, '')
        break
      }
    }

    if (!deepgramKey) {
      return NextResponse.json({ error: 'Deepgram key not configured' }, { status: 500 })
    }

    // Return a temporary token (in production, use Deepgram's token API)
    return NextResponse.json({ key: deepgramKey })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message }, { status: 500 })
  }
}
