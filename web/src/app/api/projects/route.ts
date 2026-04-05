import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { listProjects, createProject, updateProject, type Project } from '@/lib/db'

export async function GET(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const projects = listProjects(userId)
  return NextResponse.json({ projects })
}

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const data = await req.json()
  if (!data.name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  try {
    const project = createProject(userId, data)
    return NextResponse.json({ project })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Project already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { id, ...data } = await req.json()
  if (!id) return NextResponse.json({ error: 'Project ID required' }, { status: 400 })

  const ok = updateProject(userId, id, data)
  return NextResponse.json({ ok })
}
