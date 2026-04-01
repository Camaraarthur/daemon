import { requireAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)
const DAEMON_ROOT = join(process.cwd(), '..')
const VENV_PYTHON = join(DAEMON_ROOT, '.venv', 'bin', 'python3')

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const source = (formData.get('source') as string) || 'import'

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Save to temp file
    const bytes = await file.arrayBuffer()
    const tmpPath = join('/tmp', `daemon-import-${randomUUID()}${getExtension(file.name)}`)
    writeFileSync(tmpPath, Buffer.from(bytes))

    // Run import + knowledge extraction
    const script = `
import sys, json
sys.path.insert(0, '${join(DAEMON_ROOT, 'server')}')
from memory_import import import_generic
from knowledge import ensure_collections, ingest_conversation_batch

ensure_collections()

# Parse the file
conversations = import_generic('${tmpPath}')
if not conversations:
    print(json.dumps({"error": "Could not parse file", "conversations": 0}))
    sys.exit(0)

# Count total messages
total_msgs = sum(c['message_count'] for c in conversations)

# Ingest into knowledge graph
all_messages = []
for conv in conversations:
    all_messages.extend(conv['messages'])

result = ingest_conversation_batch(all_messages, source='${source}', batch_size=5)
result['conversations'] = len(conversations)
result['total_messages'] = total_msgs
result['source'] = conversations[0]['source'] if conversations else 'unknown'
print(json.dumps(result))
`

    const { stdout, stderr } = await execFileAsync(VENV_PYTHON, ['-c', script], {
      timeout: 300000, // 5 min for large imports
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: join(DAEMON_ROOT, 'server') },
    })

    // Clean up temp file
    try { unlinkSync(tmpPath) } catch {}

    // Parse the last line of output as JSON result
    const lines = stdout.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    const result = JSON.parse(lastLine)

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[import]', error?.message || error)
    return NextResponse.json(
      { error: error?.message || 'Import failed' },
      { status: 500 }
    )
  }
}

function getExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'json') return '.json'
  if (ext === 'txt') return '.txt'
  if (ext === 'zip') return '.zip'
  if (ext === 'dms') return '.dms'
  return '.tmp'
}
