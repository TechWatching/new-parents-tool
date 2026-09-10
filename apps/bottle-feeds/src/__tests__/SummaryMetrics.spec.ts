import { describe, expect, it } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import SummaryMetrics from '../components/SummaryMetrics.vue'
import { messages } from '../i18n'

describe('SummaryMetrics clock boundaries', () => {
  it('includes both rolling endpoints, excludes future entries, and ages without feed edits', async () => {
    const now = ref(Date.parse('2026-09-10T12:00:00Z'))
    const wrapper = mount(() => h(SummaryMetrics, {
      now: now.value,
      feeds: [
        { id: 'cutoff', amount: 120, occurredAt: '2026-09-09T12:00:00Z', comment: '', updatedAt: '' },
        { id: 'now', amount: 90, occurredAt: '2026-09-10T12:00:00Z', comment: '', updatedAt: '' },
        { id: 'old', amount: 200, occurredAt: '2026-09-09T11:59:59Z', comment: '', updatedAt: '' },
        { id: 'future', amount: 300, occurredAt: '2026-09-12T12:00:00Z', comment: '', updatedAt: '' },
      ],
      latestWeight: undefined,
      dailyGuide: null,
      t: messages.en,
      locale: 'en-GB',
    }))

    expect(wrapper.findAll('strong')[0]!.text()).toBe('2')
    expect(wrapper.findAll('strong')[1]!.text()).toBe('210 ml')

    now.value += 60_000
    await nextTick()

    expect(wrapper.findAll('strong')[0]!.text()).toBe('1')
    expect(wrapper.findAll('strong')[1]!.text()).toBe('90 ml')
    wrapper.unmount()
  })
})
