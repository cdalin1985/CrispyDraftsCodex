import { createTextStreamResponse, streamText, toTextStream } from 'ai'

const MAX_PROMPT_LENGTH = 200_000

const revisionInstructions = [
  'You are the revision engine inside CrispyDrafts.',
  'Follow every marked instruction precisely while preserving the writer\'s meaning, voice, formatting, and all unmarked material unless a small contextual adjustment is necessary.',
  'For custom-exact instructions, use the replacement exactly as supplied.',
  'For custom-gist instructions, rewrite the selected passage naturally in context.',
  'Return only the complete revised draft. Do not add an introduction, explanation, labels, or Markdown fences.',
].join(' ')

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return jsonError('Method not allowed.', 405)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError('The request body must be valid JSON.', 400)
    }

    const prompt = typeof body === 'object' && body !== null && 'prompt' in body
      ? (body as { prompt?: unknown }).prompt
      : undefined

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return jsonError('A draft and revision instructions are required.', 400)
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return jsonError('This draft is too large to revise in one pass.', 413)
    }

    const result = streamText({
      model: 'openai/gpt-5.4-mini',
      instructions: revisionInstructions,
      prompt,
      onError({ error }) {
        console.error('CrispyDrafts revision failed', error)
      },
    })

    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  },
}
