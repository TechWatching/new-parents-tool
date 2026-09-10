import { describe, expect, it, vi } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import ReportGenerator from '../components/ReportGenerator.vue'
import { messages } from '../i18n'

vi.mock('@nuxt/ui/composables/useToast', () => ({
  useToast: () => ({ add: vi.fn() }),
}))

describe('ReportGenerator clock boundaries', () => {
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
