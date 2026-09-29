import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dictation for free-text fields, via the browser's own SpeechRecognition.
 *
 * Chrome and Edge only (Safari partially) — Firefox has no implementation at
 * all. `supported` is false there rather than the hook pretending to work, so
 * the caller can say why instead of showing a dead button.
 *
 * Worth knowing: Chrome does NOT transcribe on-device. It streams the audio to
 * Google's servers, so dictated notes leave the machine the same way anything
 * typed into Workspace does.
 */

/**
 * ── THE PAUSE ──────────────────────────────────────────────────────────────
 * How long a silence ends dictation by itself. Raise it if people are being
 * cut off while they think mid-sentence; lower it if the mic feels like it
 * lingers after they have finished.
 */
export const SILENCE_MS = 2500

/**
 * A longer first window: clicking the mic and then gathering your thoughts
 * should not end the session before a single word is said.
 */
export const START_GRACE_MS = 6000

/** Loudness (0–1) counted as someone speaking rather than room noise. */
const SPEAKING_LEVEL = 0.06

type SpeechResultEvent = {
  resultIndex: number
  results: {
    length: number
    [index: number]: { isFinal: boolean; 0: { transcript: string } }
  }
}

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function audioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

/** Chrome's own error codes, said in plain words. */
function describe(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it in the browser address bar and try again.'
    case 'no-speech':
      return 'Nothing was picked up. Try again a little closer to the microphone.'
    case 'audio-capture':
      return 'No microphone was found.'
    case 'network':
      return 'Dictation could not reach the speech service. Check your connection.'
    default:
      return 'Dictation stopped unexpectedly. Try again.'
  }
}

export function useSpeechInput({
  onText, onInterim, lang = 'en-IN',
}: {
  /** Called with each finished phrase, for the caller to append. */
  onText: (text: string) => void
  /** Called with the running guess while a phrase is still being spoken, and
   *  with '' once it settles. Show it, but do not store it. */
  onInterim?: (text: string) => void
  lang?: string
}) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<Recognition | null>(null)

  // Held in refs so the long-lived recogniser always calls the current
  // handlers rather than the ones captured when it was created.
  const onTextRef = useRef(onText)
  const onInterimRef = useRef(onInterim)
  useEffect(() => { onTextRef.current = onText }, [onText])
  useEffect(() => { onInterimRef.current = onInterim }, [onInterim])

  /**
   * Attach to the element that draws the ripples. Loudness is written straight
   * onto it as `--level` (0–1) each frame — going through React state here
   * would re-render the whole feed sixty times a second.
   */
  const meterRef = useRef<HTMLDivElement | null>(null)

  const activeRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef(0)
  const levelRef = useRef(0)
  const interimRef = useRef('')

  // Silence watch: one interval comparing "now" against the last sound, rather
  // than tearing down and rebuilding a timeout on every frame of speech.
  const watchRef = useRef<number | undefined>(undefined)
  const lastVoiceRef = useRef(0)
  const spokeRef = useRef(false)

  const supported = recognitionCtor() !== null

  const teardown = useCallback(() => {
    window.clearInterval(watchRef.current)
    watchRef.current = undefined
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    levelRef.current = 0
    meterRef.current?.style.setProperty('--level', '0')
  }, [])

  const stop = useCallback(() => {
    activeRef.current = false
    recRef.current?.stop()
    teardown()
    setListening(false)
  }, [teardown])

  // The silence watch and the recogniser's own callbacks both need to stop the
  // session, but are created before `stop` is in scope for them.
  const stopRef = useRef(stop)
  useEffect(() => { stopRef.current = stop }, [stop])

  // Abort on unmount, or the microphone stays live after the drawer closes.
  useEffect(() => () => { recRef.current?.abort(); teardown() }, [teardown])

  /**
   * SpeechRecognition reports words but not volume, so the ripples need their
   * own tap on the microphone. It is decoration — if it fails, dictation
   * carries on without it.
   */
  const startMeter = useCallback(async () => {
    const Ctx = audioCtor()
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return
    }
    // Stopped while the permission prompt was open.
    if (!activeRef.current) { stream.getTracks().forEach((t) => t.stop()); return }

    streamRef.current = stream
    const ctx = new Ctx()
    ctxRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const d = (data[i] - 128) / 128
        sum += d * d
      }
      // Speech sits around 0.05–0.2 RMS, so lift it into a usable 0–1.
      const level = Math.min(1, Math.sqrt(sum / data.length) * 6)
      if (level > SPEAKING_LEVEL) lastVoiceRef.current = Date.now()

      // Rise fast, fall slow: the raw reading flickers between syllables and
      // the rings would strobe if they followed it exactly.
      const ease = level > levelRef.current ? 0.5 : 0.12
      levelRef.current += (level - levelRef.current) * ease
      meterRef.current?.style.setProperty('--level', levelRef.current.toFixed(2))

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) return

    setError(null)
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    // Interim guesses rewrite themselves as you speak; the caller shows them
    // separately from the settled text so nothing half-heard gets stored.
    rec.interimResults = true

    rec.onresult = (e) => {
      let settled = ''
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) settled += r[0].transcript
        else live += r[0].transcript
      }
      lastVoiceRef.current = Date.now()
      spokeRef.current = true

      if (settled.trim()) {
        onTextRef.current(settled.trim())
        interimRef.current = ''
        onInterimRef.current?.('')
      } else {
        interimRef.current = live.trim()
        onInterimRef.current?.(interimRef.current)
      }
    }
    rec.onerror = (e) => {
      // Silence between phrases is normal in a long note, not a failure.
      if (e.error !== 'no-speech' && e.error !== 'aborted') setError(describe(e.error))
    }
    rec.onend = () => {
      // A phrase still on screen when the session ends would otherwise vanish.
      if (interimRef.current) {
        onTextRef.current(interimRef.current)
        interimRef.current = ''
      }
      onInterimRef.current?.('')
      activeRef.current = false
      teardown()
      setListening(false)
    }

    recRef.current = rec
    activeRef.current = true
    interimRef.current = ''
    spokeRef.current = false
    lastVoiceRef.current = Date.now()

    watchRef.current = window.setInterval(() => {
      const quiet = Date.now() - lastVoiceRef.current
      if (quiet > (spokeRef.current ? SILENCE_MS : START_GRACE_MS)) stopRef.current()
    }, 250)

    try {
      rec.start()
      setListening(true)
    } catch {
      // start() throws if called while already running; treat as already on.
      setListening(true)
    }
    void startMeter()
  }, [lang, startMeter, teardown])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  const clearError = useCallback(() => setError(null), [])

  return { supported, listening, toggle, stop, error, clearError, meterRef }
}
