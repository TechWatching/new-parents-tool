import { supabase } from './supabase'
import type { AppData, Feed, Weight } from './types'

// ---------------------------------------------------------------------------
// Row types (snake_case ↔ camelCase mapping)
// ---------------------------------------------------------------------------

interface FeedRow {
  id: string
  user_id: string
  amount: number
  occurred_at: string
  comment: string
  updated_at: string
  deleted_at: string | null
}

interface WeightRow {
  id: string
  user_id: string
  kilograms: number
  occurred_at: string
  updated_at: string
  deleted_at: string | null
}

// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------

function feedToRow(userId: string, f: Feed): FeedRow {
  return {
    id: f.id,
    user_id: userId,
    amount: f.amount,
    occurred_at: f.occurredAt,
    comment: f.comment,
    updated_at: f.updatedAt,
    deleted_at: f.deletedAt ?? null,
  }
}

function rowToFeed(row: FeedRow): Feed {
  return {
    id: row.id,
    amount: row.amount,
    occurredAt: row.occurred_at,
    comment: row.comment,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  }
}

function weightToRow(userId: string, w: Weight): WeightRow {
  return {
    id: w.id,
    user_id: userId,
    kilograms: w.kilograms,
    occurred_at: w.occurredAt,
    updated_at: w.updatedAt,
    deleted_at: w.deletedAt ?? null,
  }
}

function rowToWeight(row: WeightRow): Weight {
  return {
    id: row.id,
    kilograms: row.kilograms,
    occurredAt: row.occurred_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Push all local feeds (including tombstones) to Supabase via upsert. */
export async function pushFeeds(
  userId: string,
  feeds: Feed[],
  signal?: AbortSignal,
): Promise<void> {
  if (!supabase || !feeds.length) return
  const query = supabase.from('feeds').upsert(
    feeds.map((f) => feedToRow(userId, f)),
    { onConflict: 'id' },
  )
  const { error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
}

/** Push all local weights (including tombstones) to Supabase via upsert. */
export async function pushWeights(
  userId: string,
  weights: Weight[],
  signal?: AbortSignal,
): Promise<void> {
  if (!supabase || !weights.length) return
  const query = supabase.from('weights').upsert(
    weights.map((w) => weightToRow(userId, w)),
    { onConflict: 'id' },
  )
  const { error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
}

/** Pull all feeds for the user from Supabase. */
export async function pullFeeds(userId: string, signal?: AbortSignal): Promise<Feed[]> {
  if (!supabase) return []
  const query = supabase.from('feeds').select('*').eq('user_id', userId)
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
  return (data as FeedRow[]).map(rowToFeed)
}

/** Pull all weights for the user from Supabase. */
export async function pullWeights(userId: string, signal?: AbortSignal): Promise<Weight[]> {
  if (!supabase) return []
  const query = supabase.from('weights').select('*').eq('user_id', userId)
  const { data, error } = await (signal ? query.abortSignal(signal) : query)
  if (error) throw error
  return (data as WeightRow[]).map(rowToWeight)
}

/** Pull the complete remote dataset for the user. */
export async function pullAll(userId: string, signal?: AbortSignal): Promise<AppData> {
  const [feeds, weights] = await Promise.all([
    pullFeeds(userId, signal),
    pullWeights(userId, signal),
  ])
  return { feeds, weights }
}

/** Permanently delete every cloud record owned by the authenticated user. */
export async function deleteAllCloudData(userId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')

  const [feedsResult, weightsResult] = await Promise.all([
    supabase.from('feeds').delete().eq('user_id', userId),
    supabase.from('weights').delete().eq('user_id', userId),
  ])

  const error = feedsResult.error ?? weightsResult.error
  if (error) throw error
}
