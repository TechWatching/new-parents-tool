import { describe, expect, it } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import SyncConflictPanel from '../components/sharing/SyncConflictPanel.vue'
import { messages } from '../i18n'
import type { Feed } from '../types'

const feed: Feed = {
  id: 'feed-1',
  amount: 100,
  occurredAt: '2026-09-10T10:00:00Z',
  updatedAt: '2026-09-10T11:00:00Z',
  comment: 'A note from this device',
}
const global = { stubs: { UButton: { template: '<button><slot /></button>' } } }

describe('conflict choices', () => {
  it('shows the local edit and shared deletion before emitting an explicit choice', async () => {
    const wrapper = mount(SyncConflictPanel, {
      props: {
        conflicts: [{
          id: 'conflict-1',
          kind: 'feed',
          local: feed,
          remote: { kind: 'feed', record: { ...feed, deletedAt: '2026-09-10T12:00:00Z' }, version: '2' },
        }],
        busy: false,
        t: messages.en,
        locale: 'en-GB',
      },
      global,
    })
    expect(wrapper.text()).toContain('100 ml')
    expect(wrapper.text()).toContain('A note from this device')
    expect(wrapper.text()).toContain(messages.en.sharingDeleted)
    expect(wrapper.emitted('resolve')).toBeUndefined()
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('resolve')).toEqual([['conflict-1', 'remote']])
    wrapper.unmount()
  })

  it('allows local recovery without an existing shared version', async () => {
    const wrapper = mount(SyncConflictPanel, {
      props: {
        conflicts: [{ id: 'conflict-2', kind: 'feed', local: feed, remote: null }],
        busy: false,
        t: messages.fr,
        locale: 'fr-FR',
      },
      global,
    })
    expect(wrapper.text()).toContain(messages.fr.sharingMissing)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('resolve')).toEqual([['conflict-2', 'local']])
    wrapper.unmount()
  })
})
