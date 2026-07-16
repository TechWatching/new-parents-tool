export interface Feed {
  id: string
  amount: number
  occurredAt: string
  comment: string
}

export interface Weight {
  id: string
  kilograms: number
  occurredAt: string
}

export interface AppData {
  feeds: Feed[]
  weights: Weight[]
}
