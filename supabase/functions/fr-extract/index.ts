// Supabase Edge Function: fr-extract
//
// Reads a business card or a signed agreement out of the private fr-documents
// bucket and asks Gemini to turn it into fields.
//
// It lives here so the Gemini key stays server-side. Anything prefixed VITE_ is
// compiled into the browser bundle and readable by every visitor, so the key is
// a function secret instead: GEMINI_API_KEY.
//
// NOTE: per the project's working rules, Edge Functions are edited in the
// Supabase dashboard. This file is the source to paste there, not a deploy
// artefact — keep the two in step by hand.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'fr-documents'
const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash'
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
}

/** Spreading a whole file into fromCharCode blows the call stack; chunk it. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const S = {
  text: { type: 'STRING', nullable: true },
  num: { type: 'NUMBER', nullable: true },
  bool: { type: 'BOOLEAN', nullable: true },
}

const CARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    full_name: S.text,
    designation: S.text,
    organisation_name: S.text,
    email: S.text,
    phone: S.text,
    linkedin_url: S.text,
    website: S.text,
    address: S.text,
  },
}

const CONTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    agreement_number: S.text,
    donor_name: S.text,
    total_value: S.num,
    currency: S.text,
    signed_date: S.text,
    start_date: S.text,
    end_date: S.text,
    is_foreign_contribution: S.bool,
    programs: { type: 'ARRAY', items: { type: 'STRING' } },
    tranches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sequence_no: S.num,
          due_date: S.text,
          amount: S.num,
          condition_note: S.text,
        },
      },
    },
    reporting_milestones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: S.text,
          due_date: S.text,
        },
      },
    },
    social_media_mention: S.bool,
    summary: S.text,
    notes: S.text,
  },
}

const CARD_PROMPT = `You are reading a photograph of a business or visiting card.

Return only what is actually printed on the card. Never invent, complete or
correct a value — if something is not on the card, use null.

- full_name: the person's name, without honorifics or qualifications.
- designation: their job title as printed.
- organisation_name: the company or institution.
- phone: keep the country code if printed. If several numbers appear, choose the
  mobile. Digits, spaces and + only.
- linkedin_url / website: full URLs; add https:// if the card omits it.
- address: the postal address on one line, if any.`

const CONTRACT_PROMPT = `You are reading a signed grant agreement or MoU between a
donor and an Indian non-profit. Extract the commercial terms.

The non-profit is the recipient — usually The/Nudge, The/Nudge Institute,
The/Nudge Foundation, Nudge Life Skills Foundation or similar. Never report that
as the donor. donor_name is the OTHER party: the funder.

- Dates: ISO yyyy-mm-dd. Indian documents write 31.03.2025, 31/03/2025 or
  31 March 2025 — all of those are day-first.
- Amounts: plain numbers, no separators or symbols. Expand Indian units, so
  "Rs. 1.5 crore" is 15000000 and "INR 25 lakhs" is 2500000.
- currency: ISO code (INR, USD, EUR, GBP, SGD, CHF).
- signed_date is when it was executed; start_date and end_date are the term or
  project period, which are often different dates.
- is_foreign_contribution: true when the donor is based outside India, or the
  agreement refers to FCRA or to foreign contribution.
- programs: names of the programs or projects funded, as written.
- tranches: the payment or instalment schedule, one entry per payment, in order.
  due_date is when that payment falls due. If a payment is tied to an event
  rather than a date (on signing, on submission of the utilisation certificate),
  leave due_date null and describe the trigger in condition_note.
- reporting_milestones: the REPORTING timeline, separate from the payment
  schedule above — often its own annexure, e.g. a table of report names against
  due dates (1st Program Report, 1st Financial Report, Annual Audit Report,
  Annual Narrative Report, Utilisation Certificate). One entry per row, title
  exactly as named in the document, due_date in the same ISO/day-first rule as
  above. Take the dates as literally stated — never infer or interpolate a
  schedule the document does not contain.
- social_media_mention: False if social media is not
  mentioned. true only if the document mentions social media in
  relation to publicising the donor or the project — including when it is only
  allowed with the donor's prior approval. 
- summary: 4-8 short lines, each starting "- ", covering only: the amount; the
  payment schedule and its conditions; which reports are due, how often, and
  the rule for their due dates (e.g. "within 15 days of each quarter end");
  and any obligation specific to this donor (publicity approval, restrictions
  on fund use, audits, dedicated bank account). If social media is subject to
  approval, just put "Social media subject to prior approval" in one point. 
  Leave out standard legal clauses such as dispute resolution, governing law, 
  indemnity, termination and confidentiality.
- notes: anything material about payment that does not fit above.

Use null for anything the document does not state. Do not calculate a schedule
the document does not contain.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  if (!GEMINI_KEY) return json(500, { error: 'GEMINI_API_KEY is not set on this function.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const authorization = req.headers.get('Authorization') ?? ''

  // The caller must be signed in AND on the fundraising team — the same gate
  // every RLS policy uses, so this cannot become a way around them.
  const asUser = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
  })
  const { data: allowed, error: authErr } = await asUser.rpc('is_fr_authorised')
  if (authErr) return json(401, { error: 'Could not verify who you are. Sign in again.' })
  if (allowed !== true) return json(403, { error: 'You do not have access to this module.' })

  let body: { kind?: string; path?: string }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Expected a JSON body.' })
  }

  const { kind, path } = body
  if (kind !== 'contact_card' && kind !== 'contract') {
    return json(400, { error: 'kind must be contact_card or contract.' })
  }
  if (!path || path.includes('..')) return json(400, { error: 'A valid file path is required.' })

  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = MIME[extension]
  if (!mimeType) return json(400, { error: `Cannot read a .${extension} file.` })
  if (kind === 'contact_card' && mimeType === 'application/pdf') {
    return json(400, { error: 'A card should be a photo, not a PDF.' })
  }

  // Service role, because the bucket is private and has no public read.
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(path)
  if (dlErr || !file) return json(404, { error: 'That file is no longer in storage.' })

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) return json(400, { error: 'That file is empty.' })

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: toBase64(bytes) } },
            { text: kind === 'contact_card' ? CARD_PROMPT : CONTRACT_PROMPT },
          ],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: kind === 'contact_card' ? CARD_SCHEMA : CONTRACT_SCHEMA,
        },
      }),
    })
  } catch {
    return json(502, { error: 'Could not reach the extraction service.' })
  }

  if (!response.ok) {
    const detail = await response.text()
    console.error('gemini error', response.status, detail)

    if (response.status === 429) {
      return json(502, { error: 'Gemini is rate limited right now. Try again in a moment.' })
    }
    // Google's own message names the actual problem — a wrong model id, a key
    // without the API enabled, a file too large. Passing it through beats
    // making someone open the function logs to find out.
    let reason = detail.slice(0, 300)
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } }
      if (parsed.error?.message) reason = parsed.error.message
    } catch { /* not JSON — the raw body will have to do */ }

    return json(502, { error: `Gemini ${response.status}: ${reason}` })
  }

  const result = await response.json()
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string') {
    console.error('gemini returned no text', JSON.stringify(result).slice(0, 800))
    return json(502, { error: 'Nothing could be read from that file.' })
  }

  try {
    return json(200, { ok: true, fields: JSON.parse(text) })
  } catch {
    return json(502, { error: 'The extraction service returned something unreadable.' })
  }
})
