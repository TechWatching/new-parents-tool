import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import TrendsCharts from '../components/TrendsCharts.vue'
import { messages } from '../i18n'

describe('TrendsCharts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows each weight when its chart point is hovered', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T12:00:00.000Z'))

    const wrapper = mount(TrendsCharts, {
      props: {
        feeds: [],
        weights: [
          { id: 'weight-1', kilograms: 4.2, occurredAt: '2026-07-18T12:00:00.000Z', updatedAt: '' },
          { id: 'weight-2', kilograms: 4.5, occurredAt: '2026-07-19T12:00:00.000Z', updatedAt: '' },
        ],
        dailyGuide: null,
        t: messages.en,
        locale: 'en-GB',
      },
    })

    expect(wrapper.findAll('.chart-line circle title').map((title) => title.text())).toEqual(['4.2 kg', '4.5 kg'])
  })

  it('uses a weight-only empty state for the weight chart', () => {
    const wrapper = mount(TrendsCharts, {
      props: {
        feeds: [],
        weights: [],
        dailyGuide: null,
        t: messages.en,
        locale: 'en-GB',
      },
    })

    const weightChart = wrapper.findAll('article')[1]!
    expect(weightChart.text()).toBe('Weight evolutionRecord a weight to see weight evolution.')
  })
})
