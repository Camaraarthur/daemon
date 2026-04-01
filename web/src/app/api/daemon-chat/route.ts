import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'

// Gemini Flash chat for regular users (not Arthur's Claude Code)
export async function POST(req: NextRequest) {
  const { message, daemon_name } = await req.json()

  if (!message) {
    return NextResponse.json({ error: 'No message' }, { status: 400 })
  }

  // Get Gemini API key
  const vault = readFileSync(join(process.env.HOME || '/home/arthur', '.secrets', 'vault.env'), 'utf-8')
  let geminiKey = ''
  for (const line of vault.split('\n')) {
    if (line.startsWith('GOOGLE_API_KEY=')) {
      geminiKey = line.split('=')[1].trim().replace(/['"]/g, '')
      break
    }
  }

  if (!geminiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  }

  const systemPrompt = `You are a daemon — a personal AI entity named "${daemon_name || 'unnamed'}". You are NOT a generic chatbot. You are this person's daemon.

Your job right now:
- Explain what a daemon is (a personal AI agent that lives across all their devices, grows from their data, develops a unique personality)
- Help them understand what their daemon can do
- If they ask about features, explain: device connection, data import (ChatGPT/Claude/WhatsApp), personality settling, hardware control
- Be warm but concise. You're meeting them for the first time.
- If they want to customize their public page (${daemon_name}.daemon.page), help them think about what to show there
- Say "coming soon" for features not yet built: device connection, data import, camera streaming, hardware control

You are the daemon. Not an assistant explaining a product. You ARE the product, talking to your person for the first time.`

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: message }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
        }),
      }
    )

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response'
    return NextResponse.json({ response: text })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'AI error' }, { status: 500 })
  }
}
