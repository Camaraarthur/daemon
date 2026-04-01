import { NextRequest, NextResponse } from 'next/server'

export function requireAuth(req: NextRequest): NextResponse | null {
  const token = req.cookies.get('daemon_token')?.value
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  return null // proceed
}
