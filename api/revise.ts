import { generateText, Output } from 'ai'
import { z } from 'zod'
import type { RevisionRequirement } from '../src/types'

const MAX_PROMPT_LENGTH = 200_000
const MAX_REQUIREMENTS = 100

const revisionInstructions = [
  'You are the revision engine inside CrispyDrafts.',
  'Every marked [M#] instruction is mandatory. Apply each one precisely while preserving the writer\'s meaning, voice, formatting, and all unmarked material unless a small contextual adjustment is necessary.',
  'Wrong angle — rethink requires a different claim, reason, benefit, or emphasis; a paraphrase or synonym swap of the original point is a failure. Rewrite the surrounding sentence when needed.',
  'For custom-exact instructions, use the replacement exactly as supplied.',
  'For custom-gist instructions, rewrite the selected passage naturally in context.',
  'For each [M#], report the exact resulting passage in the audit. Use an empty resulting passage when a mark cuts text.',
  'Do not add an introduction, explanation, labels, or Markdown fences to the revised draft.',
].join(' ')

const requirementSchema = z.object({
  id: z.string().min(1).max(20),
  label: z.string().min(1).max(80),
  kind: z.enum(['color', 'custom-exact', 'custom-gist']),
  original: z.string().min(1).max(50_000),
  replacement: z.string().max(50_000).optional(),
  start: z.number().int().nonnegative(),
  sourceLength: z.number().int().positive(),
})

const requestSchema = z.object({
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  requirements: z.array(requirementSchema).max(MAX_REQUIREMENTS).default([]),
})

const revisionOutputSchema = z.object({
  revisedDraft: z.string().min(1).describe('The complete revised draft with no commentary or Markdown fences.'),
  marks: z.array(z.object({
    id: z.string().describe('The exact [M#] identifier from the prompt.'),
    before: z.string().describe('The exact original marked passage.'),
    after: z.string().describe('The exact resulting passage copied from the revised draft, or an empty string when cut.'),
    actionTaken: z.string().describe('A concise description of how this mark was applied.'),
  })).max(MAX_REQUIREMENTS).describe('One audit entry for every marked [M#] requirement, in the same order.'),
})

type RevisionOutput = z.infer<typeof revisionOutputSchema>

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function words(value: string) {
  const normalized = normalize(value)
  return normalized ? normalized.split(' ') : []
}

const stopWords = new Set(['a', 'an', 'and', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'she', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'would', 'you', 'your'])

function meaningfulWords(value: string) {
  const allWords = words(value)
  const contentWords = allWords.filter((word) => word.length > 2 && !stopWords.has(word))
  const selectedWords = contentWords.length >= 2 ? contentWords : allWords
  return selectedWords.map((word) => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)
}

function tokenRetention(first: string, second: string) {
  const firstWords = meaningfulWords(first)
  const secondWords = meaningfulWords(second)
  if (!firstWords.length || !secondWords.length) return 0
  const counts = new Map<string, number>()
  for (const word of firstWords) counts.set(word, (counts.get(word) ?? 0) + 1)
  let matches = 0
  for (const word of secondWords) {
    const count = counts.get(word) ?? 0
    if (count > 0) {
      matches += 1
      counts.set(word, count - 1)
    }
  }
  return matches / firstWords.length
}

function validateRevision(output: RevisionOutput, requirements: RevisionRequirement[]) {
  const failures: string[] = []
  const auditById = new Map(output.marks.map((mark) => [mark.id, mark]))
  const normalizedDraft = normalize(output.revisedDraft)

  for (const requirement of requirements) {
    const audit = auditById.get(requirement.id)
    const prefix = `[${requirement.id}] ${requirement.label}`
    if (!audit) {
      failures.push(`${prefix}: no audit entry was returned`)
      continue
    }

    const original = normalize(requirement.original)
    const after = normalize(audit.after)
    const retained = tokenRetention(requirement.original, audit.after)
    const afterAppears = Boolean(after) && normalizedDraft.includes(after)
    const unchangedPassageStillAppears = words(requirement.original).length >= 4 && normalizedDraft.includes(original)

    if (normalize(audit.before) !== original) {
      failures.push(`${prefix}: the audit did not identify the correct original passage`)
      continue
    }

    if (requirement.kind === 'custom-exact') {
      const replacement = requirement.replacement?.trim() ?? ''
      if (audit.after.trim() !== replacement || !output.revisedDraft.includes(replacement) || (normalize(replacement) !== original && unchangedPassageStillAppears)) {
        failures.push(`${prefix}: the exact replacement was not used`)
      }
      continue
    }

    if (requirement.kind === 'custom-gist') {
      if (!afterAppears || retained >= 0.8 || unchangedPassageStillAppears) failures.push(`${prefix}: the gist rewrite remained too close to the original`)
      continue
    }

    if (requirement.label === 'Keep as is' || requirement.label === 'Flag for review') {
      if (!normalizedDraft.includes(original)) failures.push(`${prefix}: the passage was not preserved`)
      continue
    }

    if (requirement.label === 'Cut it') {
      if (after || normalizedDraft.includes(original)) failures.push(`${prefix}: the passage was not fully removed`)
      continue
    }

    if (!afterAppears) {
      failures.push(`${prefix}: the reported replacement was not found in the revised draft`)
      continue
    }

    if (['Reword this', 'Wrong angle — rethink', 'Good but shorten', 'Tone is off'].includes(requirement.label) && unchangedPassageStillAppears) {
      failures.push(`${prefix}: the original marked passage was left in the revised draft`)
      continue
    }

    if (requirement.label === 'Reword this' && retained >= 0.8) {
      failures.push(`${prefix}: the wording remained too similar`)
    } else if (requirement.label === 'Wrong angle — rethink' && retained >= 0.3) {
      failures.push(`${prefix}: the new angle is still too close to the original point`)
    } else if (requirement.label === 'Tone is off' && retained >= 0.7) {
      failures.push(`${prefix}: the tone rewrite remained too similar`)
    } else if (requirement.label === 'Add more detail') {
      const minimumWords = words(requirement.original).length + Math.max(3, Math.ceil(words(requirement.original).length * 0.2))
      if (words(audit.after).length < minimumWords) failures.push(`${prefix}: the passage was not expanded enough`)
    } else if (requirement.label === 'Good but shorten') {
      const maximumWords = Math.max(1, Math.floor(words(requirement.original).length * 0.8))
      if (words(audit.after).length > maximumWords) failures.push(`${prefix}: the passage was not shortened enough`)
    } else if (requirement.label === 'Move elsewhere') {
      const newPosition = normalizedDraft.indexOf(after)
      const originalRatio = requirement.start / requirement.sourceLength
      const newRatio = newPosition / Math.max(1, normalizedDraft.length)
      if (Math.abs(originalRatio - newRatio) < 0.08) failures.push(`${prefix}: the passage stayed in essentially the same position`)
    }
  }

  return failures
}

async function generateRevision(prompt: string) {
  const result = await generateText({
    model: 'openai/gpt-5.4-mini',
    instructions: revisionInstructions,
    output: Output.object({
      name: 'CrispyDraftRevision',
      description: 'A complete revised draft plus a mark-by-mark compliance audit.',
      schema: revisionOutputSchema,
    }),
    prompt,
  })
  return result.output
}

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

    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) return jsonError('The revision request is invalid or too large.', 400)

    const { prompt, requirements } = parsed.data
    const requirementsLength = requirements.reduce((total, requirement) => total + requirement.original.length + (requirement.replacement?.length ?? 0), 0)
    if (requirementsLength > MAX_PROMPT_LENGTH) return jsonError('This set of marked passages is too large to revise in one pass.', 413)

    try {
      let output = await generateRevision(prompt)
      let failures = validateRevision(output, requirements)

      if (failures.length) {
        console.warn('CrispyDrafts retrying failed mark validation', failures.map((failure) => failure.split(':')[0]))
        output = await generateRevision([
          prompt,
          '',
          'VALIDATION RETRY: The previous revision failed the mandatory checks below. Start the revision again and correct every failure.',
          ...failures.map((failure) => `- ${failure}`),
          'Do not return another near-copy for a mark that requires rewriting.',
        ].join('\n'))
        failures = validateRevision(output, requirements)
      }

      if (failures.length) {
        const failedMarks = failures.map((failure) => failure.split(':')[0]).join(', ')
        return jsonError(`Codex could not confidently apply every mark (${failedMarks}). Give those passages a Custom edit direction and try again.`, 422)
      }

      return new Response(output.revisedDraft, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      console.error('CrispyDrafts revision failed', error)
      return jsonError('Codex could not complete this revision. Please try again.', 502)
    }
  },
}
