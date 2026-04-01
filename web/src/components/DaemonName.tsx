'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import Image from 'next/image'

function getLetterSrc(char: string, hasEyes: boolean): string | null {
  const c = char.toLowerCase()
  if (c < 'a' || c > 'z') return null
  const idx = c.charCodeAt(0) - 'a'.charCodeAt(0)
  if (hasEyes) {
    return `/font/letter-${String(idx + 33).padStart(2, '0')}.png`
  } else {
    return `/font/letter-${String(idx + 7).padStart(2, '0')}.png`
  }
}

function pickWithEyes(length: number): number[] {
  const count = length <= 2 ? 1 : 2
  const indices: number[] = []
  while (indices.length < count) {
    const i = Math.floor(Math.random() * length)
    if (!indices.includes(i)) indices.push(i)
  }
  return indices
}

const LETTER_SIZE = 120
const GAP = 6

export default function DaemonName({ name, className = '' }: { name: string; className?: string }) {
  const letters = name.toLowerCase().split('').filter(c => c >= 'a' && c <= 'z')
  const [withEyes, setWithEyes] = useState<number[]>(() => pickWithEyes(letters.length))
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  const handleClick = useCallback(() => {
    setWithEyes(pickWithEyes(letters.length))
  }, [letters.length])

  useEffect(() => {
    const check = () => {
      const screenWidth = window.innerWidth - 32
      const totalWidth = letters.length * LETTER_SIZE + (letters.length - 1) * GAP
      setScale(totalWidth > screenWidth ? screenWidth / totalWidth : 1)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [letters.length])

  return (
    <div className={`w-full overflow-hidden ${className}`}>
      <div
        ref={containerRef}
        className="flex items-end justify-center cursor-pointer select-none mx-auto"
        onClick={handleClick}
        style={{
          gap: GAP,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          width: 'fit-content',
        }}
      >
        {letters.map((char, i) => {
          const hasEyes = withEyes.includes(i)
          const src = getLetterSrc(char, hasEyes)
          if (!src) return null
          return (
            <Image
              key={`${i}-${hasEyes}`}
              src={src}
              alt={char}
              width={LETTER_SIZE}
              height={LETTER_SIZE}
              className="inline-block"
              style={{
                height: LETTER_SIZE,
                width: 'auto',
                filter: 'brightness(0) saturate(100%) invert(12%) sepia(97%) saturate(7471%) hue-rotate(358deg) brightness(103%) contrast(117%)',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
