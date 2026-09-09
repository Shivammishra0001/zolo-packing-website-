import { useEffect, useState } from 'react'
import { useTheme } from '@/context/ThemeContext'

/**
 * Recharts writes colours into SVG presentation attributes, which do not
 * resolve `var(--token)`. So we read the design tokens off the document once
 * per theme change and hand Recharts concrete `hsl(...)` strings.
 */
const TOKENS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'border',
  'muted-foreground',
  'foreground',
  'card',
  'accent',
  'success',
  'warning',
  'destructive',
  'info',
] as const

type Token = (typeof TOKENS)[number]
export type ChartPalette = Record<Token, string>

const FALLBACK_LIGHT: ChartPalette = {
  'chart-1': 'hsl(174 72% 34%)',
  'chart-2': 'hsl(217 60% 32%)',
  'chart-3': 'hsl(199 82% 45%)',
  'chart-4': 'hsl(32 88% 50%)',
  'chart-5': 'hsl(262 55% 55%)',
  'chart-6': 'hsl(340 65% 52%)',
  border: 'hsl(214 26% 89%)',
  'muted-foreground': 'hsl(216 14% 46%)',
  foreground: 'hsl(217 45% 15%)',
  card: 'hsl(0 0% 100%)',
  accent: 'hsl(174 72% 30%)',
  success: 'hsl(158 68% 30%)',
  warning: 'hsl(32 88% 42%)',
  destructive: 'hsl(0 72% 46%)',
  info: 'hsl(212 84% 44%)',
}

function readPalette(): ChartPalette {
  if (typeof window === 'undefined') return FALLBACK_LIGHT
  const styles = getComputedStyle(document.documentElement)
  const palette = {} as ChartPalette
  for (const token of TOKENS) {
    const raw = styles.getPropertyValue(`--${token}`).trim()
    palette[token] = raw ? `hsl(${raw})` : FALLBACK_LIGHT[token]
  }
  return palette
}

export function useChartPalette(): ChartPalette {
  const { resolved } = useTheme()
  const [palette, setPalette] = useState<ChartPalette>(FALLBACK_LIGHT)

  useEffect(() => {
    // Wait a frame so the `dark` class is applied before we sample the tokens.
    const id = requestAnimationFrame(() => setPalette(readPalette()))
    return () => cancelAnimationFrame(id)
  }, [resolved])

  return palette
}

export const CHART_SERIES_KEYS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const

export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 10,
  minTickGap: 8,
} as const

export const GRID_PROPS = {
  vertical: false,
  strokeDasharray: '3 3',
} as const
