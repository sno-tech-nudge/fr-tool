import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Stage = {
  id: string
  key: string
  label: string
  sort_order: number
  probability_pct: number
  is_terminal: boolean
  terminal_type: 'won' | 'lost' | null
  color: string | null
  is_active: boolean
}

let cache: Stage[] | null = null
const listeners = new Set<(stages: Stage[]) => void>()

async function fetchStages(): Promise<Stage[]> {
  const { data } = await supabase
    .from('fr_pipeline_stages')
    .select('id, key, label, sort_order, probability_pct, is_terminal, terminal_type, color, is_active')
    .eq('is_active', true)
    .order('sort_order')
  cache = (data ?? []) as Stage[]
  return cache
}

/**
 * Drops the cache and pushes fresh stages to everything already mounted.
 *
 * Without this, editing a stage's win % in Configuration only took effect
 * after a full page reload — the cache exists for the whole tab's life, so
 * navigating back to the pipeline kept serving the old number.
 */
export function invalidatePipelineStages() {
  cache = null
  void fetchStages().then((stages) => listeners.forEach((notify) => notify(stages)))
}

/** The 10 pipeline stages, in board order. Cached — they change very rarely. */
export function usePipelineStages() {
  const [stages, setStages] = useState<Stage[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)

  useEffect(() => {
    listeners.add(setStages)
    return () => { listeners.delete(setStages) }
  }, [])

  useEffect(() => {
    if (cache !== null) return
    let active = true
    void fetchStages().then((next) => {
      if (!active) return
      setStages(next)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  return { stages, loading }
}

export function isWonStage(s: Stage | undefined) { return s?.terminal_type === 'won' }
export function isLostStage(s: Stage | undefined) { return s?.terminal_type === 'lost' }
