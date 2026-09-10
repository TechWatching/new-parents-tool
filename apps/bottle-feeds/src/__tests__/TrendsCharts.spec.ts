import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { mount } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
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

  it('uses the same rolling buckets for intake and bottle count and advances with the clock', async () => {
    const now = ref(Date.parse('2026-09-10T12:00:00Z'))
    const wrapper = mount(() => h(TrendsCharts, {
      now: now.value,
      feeds: [
        { id: 'cutoff', amount: 120, occurredAt: '2026-09-09T12:00:00Z', comment: '', updatedAt: '' },
        { id: 'boundary', amount: 90, occurredAt: '2026-09-09T16:00:00Z', comment: '', updatedAt: '' },
        { id: 'now', amount: 60, occurredAt: '2026-09-10T12:00:00Z', comment: '', updatedAt: '' },
        { id: 'old', amount: 500, occurredAt: '2026-09-09T11:59:59Z', comment: '', updatedAt: '' },
        { id: 'future', amount: 500, occurredAt: '2026-09-10T14:00:00Z', comment: '', updatedAt: '' },
      ],
      weights: [],
      dailyGuide: null,
      t: messages.en,
      locale: 'en-GB',
    }))
    await wrapper.get('.range-toggle button').trigger('click')

    const intake = () => wrapper.findAll('article')[0]!.findAll('.bar-value').map((bar) => bar.text())
    const counts = () => wrapper.findAll('.bottle-count-chart .bar-value').map((bar) => bar.text())
    expect(intake()).toEqual(['120', '90', '60'])
    expect(counts()).toEqual(['1', '1', '1'])
    expect(wrapper.findAll('.rolling-intake-amount').at(-1)!.text()).toBe('270 ml')

    now.value += 60_000
    await nextTick()

    expect(intake()).toEqual(['90', '60'])
    expect(counts()).toEqual(['1', '1'])
    expect(wrapper.findAll('.rolling-intake-amount').at(-1)!.text()).toBe('150 ml')
    wrapper.unmount()
  })

  it('moves the seven calendar days and weight dates forward at midnight', async () => {
    const now = ref(new Date(2026, 8, 10, 23, 59).getTime())
    const wrapper = mount(() => h(TrendsCharts, {
      now: now.value,
      feeds: [
        { id: 'first-day', amount: 120, occurredAt: new Date(2026, 8, 4, 12).toISOString(), comment: '', updatedAt: '' },
        { id: 'future', amount: 400, occurredAt: new Date(2026, 8, 11, 12).toISOString(), comment: '', updatedAt: '' },
      ],
      weights: [{ id: 'first-day', kilograms: 4.2, occurredAt: new Date(2026, 8, 4, 12).toISOString(), updatedAt: '' }],
      dailyGuide: null,
      t: messages.en,
      locale: 'en-GB',
    }))
    expect(wrapper.findAll('.bar-value').map((bar) => bar.text())).toEqual(['120', '1'])
    expect(wrapper.findAll('.weight-chart-point')).toHaveLength(1)

    now.value += 120_000
    await nextTick()

    expect(wrapper.findAll('.bar-value')).toHaveLength(0)
    expect(wrapper.findAll('.weight-chart-point')).toHaveLength(0)
    wrapper.unmount()
  })
})
