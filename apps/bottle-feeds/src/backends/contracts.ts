import type { Feed, Weight } from '../types'

export type SignInProvider = 'google' | 'microsoft'
export interface CloudUser { id: string; email?: string }
export interface FamilyMember { userId: string; name: string }
export interface Family { id: string; ownerId: string; members: FamilyMember[] }
export interface Invitation { token: string; expiresAt: string }
export type CloudRecord =
  | { kind: 'feed'; record: Feed; version: string }
  | { kind: 'weight'; record: Weight; version: string }
/** A mutation ID identifies one immutable request, including its base version. */
export type Mutation =
  | { mutationId: string; kind: 'feed'; record: Feed; baseVersion: string | null }
  | { mutationId: string; kind: 'weight'; record: Weight; baseVersion: string | null }
export type MutationResult =
  | { mutationId: string; status: 'accepted'; current: CloudRecord }
  | { mutationId: string; status: 'conflict'; current: CloudRecord | null }
export interface DeltaPage {
  /** Includes tombstones. Versions are opaque and never compared by the client. */
  records: CloudRecord[]
  /** Commit this cursor only after every page in this bounded delta has been persisted. */
  cursor: string
  nextPage: string | null
}
export type BackendErrorCode = 'auth' | 'forbidden' | 'invalid' | 'transient'
export class BackendError extends Error {
  constructor(public readonly code: BackendErrorCode, message: string) {
    super(message)
    this.name = 'BackendError'
  }
}
export interface CloudBackend {
  /** Stable deployment identity, independent of rotating public credentials. */
  readonly id: string
  auth: {
    restore(): Promise<CloudUser | null>
    signIn(provider: SignInProvider, redirectTo: string): Promise<void>
    signOut(): Promise<void>
    onChange(listener: (user: CloudUser | null) => void): () => void
  }
  family: {
    current(): Promise<Family | null>
    create(): Promise<Family>
    invite(familyId: string): Promise<Invitation>
    revokeInvitation(familyId: string): Promise<void>
    join(token: string): Promise<Family>
    leave(familyId: string): Promise<void>
    removeMember(familyId: string, userId: string): Promise<void>
    delete(familyId: string): Promise<void>
  }
  sync: {
    /** null cursor starts a paginated full history; nextPage continues the same snapshot. */
    pull(familyId: string, cursor: string | null, page: string | null, signal?: AbortSignal): Promise<DeltaPage>
    /** Authorize every call, apply only matching base versions, and replay immutable receipts on retry. */
    push(familyId: string, mutations: Mutation[], signal?: AbortSignal): Promise<MutationResult[]>
    /** Invalidation only: consumers must still pull, and polling must work without this. */
    subscribe?(familyId: string, changed: () => void): () => void
  }
  dispose(): void
}
