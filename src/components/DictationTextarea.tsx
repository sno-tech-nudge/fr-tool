import { useEffect, useId, useState } from 'react'
import { Mic } from 'lucide-react'
import { useToast } from './ui'
import { useSpeechInput } from '../hooks/useSpeechInput'

/**
 * A labelled textarea with the dictation mic in its top-right corner — the
 * same mic, ripples and silence auto-stop as the activity feed. Spoken
 * phrases append to whatever is already typed, so speaking and typing mix.
 */
export function DictationTextarea({
  label, value, onChange, rows = 3, placeholder,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
}) {
  const toast = useToast()
  const id = useId()
  // The phrase being spoken right now. Shown in the field but kept out of
  // `value` — it rewrites itself until the recogniser settles.
  const [interim, setInterim] = useState('')

  const speech = useSpeechInput({
    onText: (text) => onChange(value ? `${value.trimEnd()} ${text}` : text),
    onInterim: setInterim,
  })
  const { error: speechError, clearError } = speech
  useEffect(() => {
    if (!speechError) return
    toast.error(speechError)
    clearError()
  }, [speechError, clearError, toast])

  function toggle() {
    if (!speech.supported) {
      toast.error('Dictation needs Chrome or Edge — this browser has no speech recognition.')
      return
    }
    speech.toggle()
  }

  const shown = interim ? (value ? `${value.trimEnd()} ${interim}` : interim) : value

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className="dictate">
        <textarea
          id={id}
          className="textarea"
          rows={rows}
          placeholder={placeholder}
          value={shown}
          onChange={(e) => { setInterim(''); onChange(e.currentTarget.value) }}
        />
        <div className="dictate__halo" ref={speech.meterRef} data-listening={speech.listening} aria-hidden="true">
          <span /><span /><span />
        </div>
        <button
          type="button"
          className="dictate__mic"
          data-listening={speech.listening}
          onClick={toggle}
          aria-label={speech.listening ? 'Stop dictation' : `Dictate ${label.toLowerCase()}`}
          title={speech.listening ? 'Stop dictation' : `Dictate ${label.toLowerCase()}`}
        >
          <Mic size={14} />
        </button>
        <span className="sr-only" aria-live="polite">{speech.listening ? 'Listening' : ''}</span>
      </div>
    </div>
  )
}
