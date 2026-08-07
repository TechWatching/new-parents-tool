import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TrendsCharts from '../components/TrendsCharts.vue'
import { messages } from '../i18n'

describe('TrendsCharts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the selected weight when its chart point is activated', async () => {
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

    expect(wrapper.findAll('.weight-chart-point title').map((title) => title.text())).toEqual(['4.2 kg', '4.5 kg'])
    expect(wrapper.findAll('.weight-chart-value')).toHaveLength(0)

    await wrapper.findAll('.weight-chart-point')[1]!.trigger('click')
    await nextTick()

    expect(wrapper.find('.weight-chart-detail').text()).toBe('19 Jul 2026: 4.5 kg')
    expect(wrapper.findAll('.weight-chart-point')[1]!.classes()).toContain('selected')
  })

  it('deselects the weight when the same chart point is clicked again', async () => {
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

    const point = wrapper.findAll('.weight-chart-point')[1]!
    await point.trigger('click')
    await nextTick()
    expect(wrapper.find('.weight-chart-detail').exists()).toBe(true)

    await point.trigger('click')
    await nextTick()
    expect(wrapper.find('.weight-chart-detail').exists()).toBe(false)
    expect(point.classes()).not.toContain('selected')
  })

  it('uses a taller bottle count chart so the largest bars remain fully visible', () => {
    const wrapper = mount(TrendsCharts, {
      props: {
        feeds: [],
        weights: [],
        dailyGuide: null,
        t: messages.en,
        locale: 'en-GB',
      },
    })

    expect(wrapper.find('.bottle-count-chart').classes()).toContain('h-[240px]')
  })

  it('keeps bottle-count bar values visible by giving each bar a minimum width and unclipped text', () => {
    const wrapper = mount(TrendsCharts, {
      props: {
        feeds: [],
        weights: [],
        dailyGuide: null,
        t: messages.en,
        locale: 'en-GB',
      },
    })

    const firstBar = wrapper.find('.bottle-count-chart > div')
    expect(firstBar.classes()).toContain('min-w-[44px]')
    expect(firstBar.classes()).toContain('overflow-visible')
    expect(wrapper.find('.bottle-count-chart .bar-value').classes()).toContain('whitespace-nowrap')
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
