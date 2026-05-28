/**
 * Canonical company resolver.
 *
 * Maps a noisy extracted company name (from a press release, grant, FDA
 * filing, patent, etc.) to a row in the canonical `companies` directory.
 * Returns `null` when nothing matches — callers do NOT auto-create canonical
 * entries; the Phase 4 backfill picks up retroactive mentions whenever a user
 * adds a new company.
 *
 * Resolution cascade (cheap → expensive, stop at the first hit):
 *   1. cache       → company_resolution_cache lookup (covers ~all repeats)
 *   2. exact       → normalized name === canonical name
 *   3. alias       → normalized name === any element of canonical.aliases
 *   4. substring   → normalized name ⊂ canonical name (or vice versa) with
 *                    whole-token boundary so "bayer" doesn't match "forbayer"
 *   5. trigram     → pg_trgm similarity ≥ 0.65 with a clear top-1 winner
 *   6. LLM         → 2+ trigram candidates in 0.45–0.65 range → Haiku picks
 *                    one of them or "none"
 *   7. no_match    → null, cached so we don't re-LLM the same name
 *
 * Every resolution (hit or miss) gets written to the cache. Invalidation runs
 * via DB triggers on `companies` INSERT/UPDATE (see migration
 * 20260527_company_resolution_cache.sql).
 */
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import type { createAdminClient } from '@/lib/supabase-admin';
import { uniqueTokenCoverage, sharesDistinctiveToken, distinctiveTokens } from './match-helpers';

// Re-export so existing callers (and tests) can import either path.
export { uniqueTokenCoverage };

// ── Public API ────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>;

export type ResolveSource =
  | 'cache'
  | 'exact'
  | 'alias'
  | 'substring'
  | 'trgm'
  | 'llm'
  | 'no_match';

export type ResolveResult = {
  /** Raw input name (unchanged). */
  name: string;
  /** Normalized form used for matching. */
  normalized: string;
  /** Resolved canonical company id, or null on no match. */
  canonicalId: string | null;
  /** 0–1, higher = more confident. 1 for exact/alias, 0 for no_match. */
  confidence: number;
  /** Which cascade step produced the result. */
  resolvedBy: ResolveSource;
};

const TRGM_HIGH_CONFIDENCE = 0.65;
const TRGM_MIN_CANDIDATE = 0.45;
const SUBSTRING_CONFIDENCE = 0.85;

/**
 * Resolve a batch of raw company names against the canonical directory.
 * Returns a Map keyed by the original raw name (preserves caller order).
 */
export async function resolveCompanyMentions(
  admin: AdminClient,
  names: string[],
): Promise<Map<string, ResolveResult>> {
  const out = new Map<string, ResolveResult>();
  if (names.length === 0) return out;

  // Deduplicate by normalized form; multiple raw inputs sharing a normalized
  // form share a single resolution.
  const byNormalized = new Map<string, string[]>(); // normalized → raw inputs
  for (const raw of names) {
    const norm = normalizeCompanyForMatching(raw);
    if (!norm || norm.length < 3) {
      out.set(raw, { name: raw, normalized: norm, canonicalId: null, confidence: 0, resolvedBy: 'no_match' });
      continue;
    }
    if (!byNormalized.has(norm)) byNormalized.set(norm, []);
    byNormalized.get(norm)!.push(raw);
  }

  const normalizedKeys = [...byNormalized.keys()];
  if (normalizedKeys.length === 0) return out;

  // 1. Cache lookup (batched)
  const cached = await fetchCache(admin, normalizedKeys);
  const stillNeeded: string[] = [];
  for (const norm of normalizedKeys) {
    const hit = cached.get(norm);
    if (hit) {
      for (const raw of byNormalized.get(norm)!) {
        out.set(raw, { ...hit, name: raw, normalized: norm, resolvedBy: 'cache' });
      }
    } else {
      stillNeeded.push(norm);
    }
  }

  if (stillNeeded.length === 0) return out;

  // 2–5. Run cascade against canonical directory in a single SQL pass per name.
  // Companies table is bounded (16 today, low-thousands at scale); load it
  // once into memory rather than N queries.
  const directory = await fetchDirectory(admin);

  const cacheWrites: Array<Omit<ResolveResult, 'name'>> = [];

  for (const norm of stillNeeded) {
    const result = await resolveOne(admin, norm, directory);
    cacheWrites.push(result);
    for (const raw of byNormalized.get(norm)!) {
      out.set(raw, { ...result, name: raw });
    }
  }

  // Write cache async-ish — fire and forget would lose errors, so await
  // but in a single batch upsert.
  await writeCache(admin, cacheWrites);

  return out;
}

// ── Internals ─────────────────────────────────────────────────────────────────

type DirectoryRow = {
  id: string;
  company_name: string;
  name_normalized: string;
  aliases_normalized: string[];
};

async function fetchDirectory(admin: AdminClient): Promise<DirectoryRow[]> {
  const { data, error } = await admin
    .from('companies')
    .select('id, company_name, aliases');
  if (error) throw new Error(`resolver fetchDirectory: ${error.message}`);
  return (data ?? [])
    .map((row) => {
      const name = (row as { company_name?: string | null }).company_name ?? '';
      const aliases = ((row as { aliases?: string[] | null }).aliases ?? []) as string[];
      return {
        id: (row as { id: string }).id,
        company_name: name,
        name_normalized: normalizeCompanyForMatching(name),
        aliases_normalized: aliases.map(normalizeCompanyForMatching).filter(Boolean),
      };
    })
    .filter((r) => r.name_normalized.length >= 3);
}

async function fetchCache(
  admin: AdminClient,
  normalizedKeys: string[],
): Promise<Map<string, Omit<ResolveResult, 'name' | 'normalized'>>> {
  const out = new Map<string, Omit<ResolveResult, 'name' | 'normalized'>>();
  if (normalizedKeys.length === 0) return out;

  // Batch in chunks of 200 to keep the IN clause reasonable.
  for (let i = 0; i < normalizedKeys.length; i += 200) {
    const slice = normalizedKeys.slice(i, i + 200);
    const { data, error } = await admin
      .from('company_resolution_cache')
      .select('raw_name_normalized, canonical_company_id, confidence, resolved_by')
      .in('raw_name_normalized', slice);
    if (error) throw new Error(`resolver fetchCache: ${error.message}`);
    for (const row of data ?? []) {
      const r = row as {
        raw_name_normalized: string;
        canonical_company_id: string | null;
        confidence: number;
        resolved_by: string;
      };
      out.set(r.raw_name_normalized, {
        canonicalId: r.canonical_company_id,
        confidence: r.confidence,
        resolvedBy: r.resolved_by as ResolveSource,
      });
    }
  }
  return out;
}

async function writeCache(
  admin: AdminClient,
  entries: Array<Omit<ResolveResult, 'name'>>,
): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    raw_name_normalized: e.normalized,
    canonical_company_id: e.canonicalId,
    confidence: e.confidence,
    resolved_by: e.resolvedBy === 'cache' ? 'exact' : e.resolvedBy, // shouldn't happen, but guard
    resolved_at: new Date().toISOString(),
  }));
  // Upsert in chunks; a fresh resolve overwrites a stale cached miss.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin
      .from('company_resolution_cache')
      .upsert(rows.slice(i, i + 200), { onConflict: 'raw_name_normalized' });
    if (error) {
      // Cache write failure shouldn't break the caller — log and move on.
      console.error('[company-resolver] cache write failed:', error.message);
    }
  }
}

async function resolveOne(
  admin: AdminClient,
  norm: string,
  directory: DirectoryRow[],
): Promise<Omit<ResolveResult, 'name'>> {
  // 2. Exact name match
  const exactName = directory.find((r) => r.name_normalized === norm);
  if (exactName) {
    return { normalized: norm, canonicalId: exactName.id, confidence: 1, resolvedBy: 'exact' };
  }

  // 3. Exact alias match
  for (const row of directory) {
    if (row.aliases_normalized.includes(norm)) {
      return { normalized: norm, canonicalId: row.id, confidence: 0.95, resolvedBy: 'alias' };
    }
  }

  // 4. Distinctive-token containment: the input's distinctive (non-generic)
  // tokens must be fully covered by the candidate. Filtering out generic
  // tokens prevents "PH HEALTH" from matching "PerkinElmer Health Sciences"
  // on the shared "health" alone.
  const inputDistinctive = distinctiveTokens(norm);
  if (inputDistinctive.size > 0) {
    let best: { row: DirectoryRow; coverage: number } | null = null;
    for (const row of directory) {
      const cand = uniqueTokenCoverage(inputDistinctive, row.name_normalized, row.aliases_normalized);
      if (cand !== null && (best === null || cand > best.coverage)) {
        best = { row, coverage: cand };
      }
    }
    if (best && best.coverage >= 1) {
      return {
        normalized: norm,
        canonicalId: best.row.id,
        confidence: SUBSTRING_CONFIDENCE,
        resolvedBy: 'substring',
      };
    }
  }

  // 5/6. Trigram via SQL.
  const candidates = await trigramCandidates(admin, norm);
  if (candidates.length === 0) {
    return { normalized: norm, canonicalId: null, confidence: 0, resolvedBy: 'no_match' };
  }

  const top = candidates[0];
  const second = candidates[1];

  // 5. High-confidence single winner — but still require a shared
  // distinctive token. "alcon laboratories" vs "alkem laboratories" has
  // trigram similarity 0.65 (just over threshold) but zero distinctive-token
  // overlap, and they are entirely different companies.
  if (top.similarity >= TRGM_HIGH_CONFIDENCE && (!second || top.similarity - second.similarity >= 0.15)) {
    const candNorm = directory.find((d) => d.id === top.id)?.name_normalized ?? top.company_name.toLowerCase();
    if (sharesDistinctiveToken(norm, candNorm)) {
      return {
        normalized: norm,
        canonicalId: top.id,
        confidence: top.similarity,
        resolvedBy: 'trgm',
      };
    }
    // Fall through to LLM disambiguation, which applies the same filter
    // and will return no_match if all candidates fail it.
  }

  // 6. Anything below high-confidence goes through LLM verification — even a
  // single candidate. Shared suffix tokens (biosciences/therapeutics/pharma)
  // produce ~0.45–0.55 trigram similarity for entirely unrelated companies
  // (e.g. "junshi biosciences" vs "enzene biosciences" = 0.46), so we can't
  // trust a single low-confidence hit without an LLM sanity check.
  //
  // Pre-filter: drop candidates whose only token overlap with the input is a
  // generic suffix. Even Haiku struggles to reject "Junshi Biosciences" vs
  // "Enzene Biosciences" — easier to never ask the question.
  const llmCandidates = candidates
    .filter((c) => c.similarity >= TRGM_MIN_CANDIDATE)
    .filter((c) => {
      const candNorm = directory.find((d) => d.id === c.id)?.name_normalized ?? c.company_name.toLowerCase();
      return sharesDistinctiveToken(norm, candNorm);
    })
    .slice(0, 5);

  if (llmCandidates.length === 0) {
    return { normalized: norm, canonicalId: null, confidence: 0, resolvedBy: 'no_match' };
  }

  const picked = await llmDisambiguate(norm, llmCandidates);
  if (!picked) {
    return { normalized: norm, canonicalId: null, confidence: 0, resolvedBy: 'no_match' };
  }
  return {
    normalized: norm,
    canonicalId: picked,
    confidence: 0.75, // LLM-picked from shortlist; conservative bound
    resolvedBy: 'llm',
  };
}

type TrigramCandidate = { id: string; company_name: string; similarity: number };

async function trigramCandidates(
  admin: AdminClient,
  norm: string,
): Promise<TrigramCandidate[]> {
  // Compute similarity inline against both company_name and unnested aliases,
  // take the per-company max. Limit to top 10 to keep payload tiny.
  const { data, error } = await admin.rpc('resolve_company_candidates', {
    p_query: norm,
    p_limit: 10,
    p_min_similarity: TRGM_MIN_CANDIDATE,
  });
  if (error) {
    // RPC missing → fall back to no candidates so resolver returns no_match
    // rather than blowing up. The RPC migration ships alongside this file.
    console.error('[company-resolver] resolve_company_candidates RPC error:', error.message);
    return [];
  }
  return ((data ?? []) as unknown[]).map((r) => ({
    id: (r as { id: string }).id,
    company_name: (r as { company_name: string }).company_name,
    similarity: Number((r as { similarity: number }).similarity),
  }));
}

async function llmDisambiguate(
  query: string,
  candidates: TrigramCandidate[],
): Promise<string | null> {
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.company_name} (id: ${c.id})`)
    .join('\n');
  const prompt = `You are matching an extracted company mention to a known company directory.

Extracted name: "${query}"

Candidate companies (pre-filtered by name similarity):
${list}

Pick the SINGLE candidate that refers to the same real-world company as the extracted name, or respond "none" if none match.

IMPORTANT: Many biotech company names share generic suffixes like "Biosciences", "Therapeutics", "Pharmaceuticals", "Bio", "Health". Sharing one of these words does NOT make two companies the same. "Junshi Biosciences" is not "Enzene Biosciences". "Spyre Therapeutics" is not "Seaport Therapeutics". Only match if the DISTINGUISHING part of the name (the non-generic word) is the same company, or a known alias / parent / subsidiary.

Respond with ONLY the candidate id (uuid) or the word "none". No prose.`;

  const completion = await completeLlm({
    feature: 'company_resolution',
    prompt,
    maxTokens: 60,
    temperature: 0,
  });
  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'company_resolution',
    route: 'lib/companies/resolve-mentions#llmDisambiguate',
    model: completion.model,
    usage: completion.usage,
    metadata: { query: query.slice(0, 200), n_candidates: candidates.length },
  });

  const answer = completion.text.trim().toLowerCase();
  if (answer === 'none' || answer.startsWith('none')) return null;

  // Extract the first uuid-shaped token from the response.
  const match = answer.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!match) return null;
  const picked = match[0];
  // Verify it's one of the offered candidates (defensive against hallucinated ids).
  return candidates.some((c) => c.id.toLowerCase() === picked) ? picked : null;
}
