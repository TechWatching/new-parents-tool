import { describe, expect, it, vi } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import ReportGenerator from '../components/ReportGenerator.vue'
import { messages } from '../i18n'

vi.mock('@nuxt/ui/composables/useToast', () => ({
  useToast: () => ({ add: vi.fn() }),
}))

describe('ReportGenerator clock boundaries', () => {
  it('checks conflicts again at the actual PDF snapshot time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T12:01:00Z'))
    const feed = { id: 'boundary-conflict', amount: 120, occurredAt: '2026-09-10T12:00:30Z', comment: '', updatedAt: '2026-09-10T12:00:30Z' }
    const wrapper = mount(ReportGenerator, {
      props: {
        now: Date.parse('2026-09-10T12:00:00Z'),
        feeds: [feed],
        weights: [],
        conflicts: [{ kind: 'feed', local: feed, remote: { kind: 'feed', record: { ...feed, amount: 150 }, version: '2' } }],
        t: messages.en,
        locale: 'en-GB',
      },
      global: { stubs: { UButton: { template: '<button><slot /></button>' } } },
    })
    try {
      await wrapper.get('[aria-controls="report-panel"]').trigger('click')
      expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
      await wrapper.get('form').trigger('submit')
      expect(wrapper.text()).toContain(messages.en.reportGenerationError)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('disables affected PDFs but allows reports that exclude the conflicting category', async () => {
    const feed = { id: 'conflicted', amount: 120, occurredAt: '2026-09-10T10:00:00Z', comment: '', updatedAt: '2026-09-10T10:00:00Z' }
    const wrapper = mount(ReportGenerator, {
      props: {
        now: Date.parse('2026-09-10T12:00:00Z'),
        feeds: [feed],
        weights: [],
        conflicts: [{ kind: 'feed', local: feed, remote: { kind: 'feed', record: { ...feed, amount: 150 }, version: '2' } }],
        t: messages.en,
        locale: 'en-GB',
      },
      global: { stubs: { UButton: { template: '<button><slot /></button>' } } },
    })
    await wrapper.get('[aria-controls="report-panel"]').trigger('click')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(messages.en.sharingReportBlocked)
    await wrapper.findAll('input[type=checkbox]')[0]!.setValue(false)
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain(messages.en.sharingReportBlocked)
    wrapper.unmount()
  })

  it('refreshes the preview when the shared clock advances without changing the feeds', async () => {
    const now = ref(Date.parse('2026-09-10T12:00:00Z'))
    const wrapper = mount(() => h(ReportGenerator, {
      now: now.value,
      feeds: [{ id: 'aging', amount: 120, occurredAt: '2026-09-09T12:01:00Z', comment: '', updatedAt: '' }],
      weights: [],
      t: messages.en,
      locale: 'en-GB',
    }), {
      global: { stubs: { UButton: { template: '<button><slot /></button>' } } },
    })

    await wrapper.get('[aria-controls="report-panel"]').trigger('click')
    expect(wrapper.get('[aria-live="polite"] strong').text()).toBe('1')

    now.value += 120_000
    await nextTick()

    expect(wrapper.get('[aria-live="polite"] strong').text()).toBe('0')
    expect(wrapper.text()).toContain(messages.en.reportNoDataInRange)
    wrapper.unmount()
  })
})
