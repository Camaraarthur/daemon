/**
 * GET /api/apis — Returns API registry with cached live status.
 * Status checks are cached for 5 minutes.
 */

import { NextResponse } from 'next/server'
import { API_REGISTRY, getApisByCategory, getActiveApiCount, getProApiCount } from '@/lib/api-registry'

let cachedResult: { data: any; timestamp: number } | null = null
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function GET() {
  const now = Date.now()

  if (cachedResult && (now - cachedResult.timestamp) < CACHE_TTL) {
    return NextResponse.json(cachedResult.data)
  }

  const byCategory = getApisByCategory()
  const activeCount = getActiveApiCount()
  const proCount = getProApiCount()

  const result = {
    apis: API_REGISTRY,
    byCategory,
    stats: {
      total: API_REGISTRY.length,
      active: activeCount,
      proOnly: proCount,
      freeIncluded: API_REGISTRY.filter(a => a.includedInFree).length,
    },
    cachedAt: new Date().toISOString(),
  }

  cachedResult = { data: result, timestamp: now }

  return NextResponse.json(result)
}
