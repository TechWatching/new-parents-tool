<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import UButton from '@nuxt/ui/components/Button.vue'
import type { CloudUser, Family, Invitation, SignInProvider } from '../../backends/contracts'
import type { Messages } from '../../i18n'

const props = defineProps<{
  available: boolean
  user: CloudUser | null
  family: Family | null
  enabled: boolean
  needsResume: boolean
  pendingInvitation: boolean
  invitation: Invitation | null
  pendingCount: number
  busy: boolean
  error: string | null
  t: Messages
  locale: string
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  signIn: [provider: SignInProvider]
  signOut: []
  create: []
  join: []
  invite: []
  revoke: []
  leave: []
  remove: []
  delete: []
  resume: []
  sync: []
}>()
type ConfirmAction = 'signOut' | 'leave' | 'remove' | 'delete'
const confirmAction = shallowRef<ConfirmAction | null>(null)
const copyStatus = shallowRef<'idle' | 'copied' | 'error'>('idle')
const isOwner = computed(() => props.family?.ownerId === props.user?.id && !!props.user)
const invitationUrl = computed(() => {
  if (!props.invitation) return ''
  const url = new URL(import.meta.env.BASE_URL, location.origin)
  url.hash = new URLSearchParams({ invite: props.invitation.token }).toString()
  return url.href
})
const confirmation = computed(() => {
  switch (confirmAction.value) {
    case 'signOut': return props.t.sharingSignOutHelp
    case 'leave': return props.t.sharingLeaveHelp
    case 'remove': return props.t.sharingRemoveHelp
    case 'delete': return props.t.sharingDeleteHelp
    default: return ''
  }
})
watch(() => [props.family?.id, props.user?.id], () => { confirmAction.value = null })
watch(invitationUrl, () => { copyStatus.value = 'idle' })
watch(
  () => [props.pendingInvitation, props.needsResume, props.error],
  ([pending, resume, error]) => { if (pending || resume || error) open.value = true },
  { immediate: true },
)

function handleToggle(event: Event) {
  if (event.target instanceof HTMLDetailsElement) open.value = event.target.open
}

function confirm() {
  switch (confirmAction.value) {
    case 'signOut': emit('signOut'); break
    case 'leave': emit('leave'); break
    case 'remove': emit('remove'); break
    case 'delete': emit('delete'); break
  }
  confirmAction.value = null
}

async function copyInvitation() {
  try {
    await navigator.clipboard.writeText(invitationUrl.value)
    copyStatus.value = 'copied'
  } catch {
    copyStatus.value = 'error'
  }
}
</script>

<template>
  <details
    v-if="available || family"
    class="surface mb-5 p-4 sm:p-5"
    :open="open"
    @toggle="handleToggle"
  >
    <summary class="cursor-pointer text-sm font-bold text-highlighted">
      {{ family ? t.sharingFamily : t.sharingTitle }}
    </summary>
    <div class="mt-4 grid gap-3 text-sm">
      <p v-if="!available" class="max-w-prose text-toned">{{ t.sharingUnavailable }}</p>
      <template v-else-if="!user">
        <p class="max-w-prose text-toned">{{ pendingInvitation ? t.sharingJoinHelp : t.sharingOptional }}</p>
        <p class="max-w-prose text-muted">{{ t.sharingConsent }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton :disabled="busy" color="neutral" variant="outline" @click="emit('signIn', 'google')">{{ t.sharingGoogle }}</UButton>
          <UButton :disabled="busy" color="neutral" variant="outline" @click="emit('signIn', 'microsoft')">{{ t.sharingMicrosoft }}</UButton>
        </div>
      </template>
      <template v-else>
        <p class="break-all text-toned">{{ user.email }}</p>
        <template v-if="!family">
          <p class="max-w-prose text-muted">{{ pendingInvitation ? t.sharingJoinHelp : t.sharingCreateHelp }}</p>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="pendingInvitation" :loading="busy" @click="emit('join')">{{ t.sharingJoin }}</UButton>
            <UButton v-else :loading="busy" @click="emit('create')">{{ t.sharingCreate }}</UButton>
          </div>
        </template>
        <template v-else>
          <p class="text-toned">{{ t.sharingMembers }}: {{ family.members.length }} / 2</p>
          <ul class="list-inside list-disc text-muted">
            <li v-for="member in family.members" :key="member.userId">{{ member.name }}</li>
          </ul>
          <template v-if="needsResume || !enabled">
            <p class="max-w-prose text-toned">{{ t.sharingResumeHelp }}</p>
            <UButton class="justify-self-start" :loading="busy" @click="emit('resume')">{{ t.sharingResume }}</UButton>
          </template>
          <div v-if="enabled" class="flex flex-wrap items-center gap-2">
            <span v-if="pendingCount" role="status">{{ t.sharingPending.replace('{count}', String(pendingCount)) }}</span>
            <UButton :disabled="busy" color="neutral" variant="outline" @click="emit('sync')">{{ t.sharingRetry }}</UButton>
            <UButton v-if="isOwner && family.members.length < 2" :disabled="busy" color="neutral" variant="outline" @click="emit('invite')">{{ t.sharingInvite }}</UButton>
            <UButton v-if="isOwner" :disabled="busy" color="neutral" variant="ghost" @click="emit('revoke')">{{ t.sharingRevoke }}</UButton>
          </div>
          <div v-if="invitation" class="grid max-w-2xl gap-2">
            <label for="family-invitation">{{ t.sharingInviteHelp }}</label>
            <input id="family-invitation" class="field w-full" readonly :value="invitationUrl">
            <p class="text-muted">{{ t.sharingInviteExpiry }}: {{ new Date(invitation.expiresAt).toLocaleString(locale) }}</p>
            <UButton class="justify-self-start" color="neutral" variant="outline" @click="copyInvitation">{{ t.sharingCopy }}</UButton>
            <p v-if="copyStatus !== 'idle'" role="status">{{ copyStatus === 'copied' ? t.sharingCopied : t.sharingCopyError }}</p>
          </div>
          <div class="flex flex-wrap gap-2 border-t border-default pt-3">
            <UButton v-if="!isOwner" :disabled="busy" color="error" variant="ghost" @click="confirmAction = 'leave'">{{ t.sharingLeave }}</UButton>
            <UButton v-if="isOwner && family.members.length > 1" :disabled="busy" color="error" variant="ghost" @click="confirmAction = 'remove'">{{ t.sharingRemove }}</UButton>
            <UButton v-if="isOwner" :disabled="busy" color="error" variant="ghost" @click="confirmAction = 'delete'">{{ t.sharingDelete }}</UButton>
          </div>
        </template>
      </template>
      <UButton v-if="user || family" class="justify-self-start" :disabled="busy" color="neutral" variant="ghost" @click="confirmAction = 'signOut'">{{ t.sharingSignOut }}</UButton>
      <div v-if="confirmAction" class="max-w-prose rounded-lg border border-coral-200 bg-coral-50 p-3" role="alert">
        <p>{{ confirmation }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" @click="confirmAction = null">{{ t.sharingCancel }}</UButton>
          <UButton color="error" :disabled="busy" @click="confirm">{{ t.sharingConfirm }}</UButton>
        </div>
      </div>
      <p v-if="error" class="break-words text-red-800" role="alert">{{ error }}</p>
    </div>
  </details>
</template>
