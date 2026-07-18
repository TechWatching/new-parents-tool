export interface Feed {
  id: string
  amount: number
  occurredAt: string
  comment: string
  updatedAt: string
  deletedAt?: string
}

export interface Weight {
  id: string
  kilograms: number
  occurredAt: string
  updatedAt: string
  deletedAt?: string
}

export interface AppData {
  feeds: Feed[]
  weights: Weight[]
}

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'error' | 'synced'
