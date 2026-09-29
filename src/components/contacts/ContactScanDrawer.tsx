import { useEffect, useRef, useState } from 'react'
import { Camera, ImageUp, Trash2 } from 'lucide-react'
import { Button, Drawer, useToast } from '../ui'
import {
  MAX_IMAGE_BYTES, extractContactCard, readableSize, removeDocument, uploadDocument,
  type ContactCardFields,
} from '../../lib/documents'

/**
 * A phone held in one hand is the likely camera; a laptop's "take a photo"
 * button just reopens the same file picker, so it is only offered where it
 * does something different.
 */
function hasCamera(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Picks a photo of a business card, reads it, and hands the fields to the
 * contact form for the person to check before saving.
 *
 * Nothing is written to fr_contacts here. OCR on a phone photo of a card at an
 * angle gets digits wrong often enough that a silent save would quietly poison
 * the directory, so the form always opens for review.
 */
export function ContactScanDrawer({
  open, onClose, onEnterManually, onExtracted,
}: {
  open: boolean
  onClose: () => void
  onEnterManually: () => void
  onExtracted: (fields: ContactCardFields, cardPath: string) => void
}) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  // Object URLs are a manual allocation — without revoking, every image picked
  // in a session stays in memory until the tab closes.
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => { if (!open) { setFile(null); setBusy(false) } }, [open])

  function accept(picked: File | undefined) {
    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      toast.error('That is not an image. Pick a photo or a scan of the card.')
      return
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      toast.error(`That image is ${readableSize(picked.size)}. Keep it under 10 MB.`)
      return
    }
    setFile(picked)
  }

  async function extract() {
    if (!file) return
    setBusy(true)
    let path: string | null = null
    try {
      path = await uploadDocument('contact-cards', file)
      const fields = await extractContactCard(path)
      onExtracted(fields, path)
    } catch (e) {
      // The upload survived but the read did not, so the image would otherwise
      // sit in the bucket attached to nothing.
      if (path) void removeDocument(path)
      toast.error(e instanceof Error ? e.message : 'Could not read that card.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      title="Upload contact card"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onEnterManually} disabled={busy}>Enter manually</Button>
          <Button onClick={() => void extract()} disabled={!file || busy}>
            {busy ? 'Reading…' : 'Extract details'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {preview ? (
          <div className="stack">
            <img src={preview} alt="The card you picked" className="scanpreview" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 'var(--text-sm)' }}>
                {file?.name} · <span className="tn-num">{readableSize(file?.size ?? 0)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<Trash2 size={14} />}
                onClick={() => setFile(null)}
                disabled={busy}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="dropzone"
            data-dragging={dragging}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              accept(e.dataTransfer.files?.[0])
            }}
          >
            <ImageUp size={22} />
            <p className="dropzone__title">Drop a photo of the card here</p>
            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Button variant="secondary" size="sm" onClick={() => pickRef.current?.click()}>
                Choose image
              </Button>
              {hasCamera() ? (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Camera size={14} />}
                  onClick={() => cameraRef.current?.click()}
                >
                  Take a photo
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => accept(e.currentTarget.files?.[0])}
        />
        {/* capture= opens the camera directly on a phone; desktop ignores it. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => accept(e.currentTarget.files?.[0])}
        />

        <p className="chartsub">
          The card is read into a contact form for you to check before saving. The image stays
          with the contact.
        </p>
      </div>
    </Drawer>
  )
}
