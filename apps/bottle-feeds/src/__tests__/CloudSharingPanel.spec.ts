import { describe, expect, it } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import CloudSharingPanel from '../components/sharing/CloudSharingPanel.vue'
import { messages } from '../i18n'
import type { Family } from '../backends/contracts'

const family: Family = {
  id: 'family',
  ownerId: 'mother',
  members: [{ userId: 'mother', name: 'Mother' }, { userId: 'father', name: 'Father' }],
}
const baseProps = {
  available: true,
  user: null,
  family: null,
  enabled: false,
  needsResume: false,
  pendingInvitation: false,
  invitation: null,
  pendingCount: 0,
  busy: false,
  error: null,
  t: messages.en,
  locale: 'en-GB',
}
const global = { stubs: { UButton: { template: '<button><slot /></button>' } } }

describe('optional family sharing controls', () => {
  it('renders no cloud controls without configuration or cached history', () => {
    const wrapper = mount(CloudSharingPanel, { props: { ...baseProps, available: false }, global })
    expect(wrapper.find('details').exists()).toBe(false)
    wrapper.unmount()
  })
  it('requires an explicit provider selection without an email form', async () => {
    const wrapper = mount(CloudSharingPanel, { props: baseProps, global })
    expect(wrapper.emitted('signIn')).toBeUndefined()
    expect(wrapper.find('input[type=email]').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === messages.en.sharingMicrosoft)!.trigger('click')
    expect(wrapper.emitted('signIn')).toEqual([['microsoft']])
    wrapper.unmount()
  })
  it('does not show owner-only actions to the invited parent', () => {
    const wrapper = mount(CloudSharingPanel, {
      props: { ...baseProps, user: { id: 'father' }, family, enabled: true },
      global,
    })
    expect(wrapper.text()).toContain(messages.en.sharingLeave)
    expect(wrapper.text()).not.toContain(messages.en.sharingDelete)
    expect(wrapper.text()).not.toContain(messages.en.sharingRemove)
    wrapper.unmount()
  })
  it('requires a warning confirmation before sign-out with pending work', async () => {
    const wrapper = mount(CloudSharingPanel, {
      props: { ...baseProps, user: { id: 'mother' }, family, enabled: true, pendingCount: 3 },
      global,
    })
    const button = (text: string) => wrapper.findAll('button').find(element => element.text() === text)!
    await button(messages.en.sharingSignOut).trigger('click')
    expect(wrapper.emitted('signOut')).toBeUndefined()
    expect(wrapper.get('[role=alert]').text()).toContain(messages.en.sharingSignOutHelp)
    await button(messages.en.sharingConfirm).trigger('click')
    expect(wrapper.emitted('signOut')).toHaveLength(1)
    wrapper.unmount()
  })
  it('preserves sign-out access when configuration disappears', () => {
    const wrapper = mount(CloudSharingPanel, {
      props: { ...baseProps, available: false, family },
      global,
    })
    expect(wrapper.text()).toContain(messages.en.sharingUnavailable)
    expect(wrapper.text()).toContain(messages.en.sharingSignOut)
    expect(wrapper.text()).not.toContain(messages.en.sharingGoogle)
    wrapper.unmount()
  })
})
