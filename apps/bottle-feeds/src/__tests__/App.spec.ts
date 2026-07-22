import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import memoryDriver from 'unstorage/drivers/memory'

const reportPdfSpies = vi.hoisted(() => ({
  generateReportPdfBlob: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
  downloadPdf: vi.fn(),
}))

vi.mock('../report/pdf', () => reportPdfSpies)

import AppRoot from '../AppRoot.vue'
import { loadData, saveData, _setTestDriver, GUEST_NAMESPACE } from '../storage'
import type { AppData } from '../types'
import { dateTimeForInput, LATEST_ENTRY_DATE_DURATION } from '../utils/time'

// Silence storage-related console warnings in tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    _setTestDriver(memoryDriver())
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'test-id' })
    reportPdfSpies.generateReportPdfBlob.mockClear()
    reportPdfSpies.downloadPdf.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    _setTestDriver(null)
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  const mountApp = async () => {
    wrapper = mount(AppRoot, {
      attachTo: document.body,
      global: {
        plugins: [
          createRouter({
            history: createWebHistory(),
            routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
          }),
        ],
      },
    })
    // Wait for onMounted async initialization (loadData + initAuth)
    await flushPromises()
    return wrapper
  }

  it('records a bottle and persists it locally', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.feed-card input[type="number"]').setValue('120')
    await wrapper.get('.feed-card input[type="date"]').setValue('2026-07-14')
    await wrapper.get('.feed-card input[inputmode="numeric"]').setValue('14:30')
    await wrapper.get('.feed-card input[maxlength="160"]').setValue('Drank well')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('120 ml')
    expect(wrapper.text()).toContain('Drank well')

    const stored = await loadData(GUEST_NAMESPACE)
    expect(stored.feeds[0]).toMatchObject({
      occurredAt: '2026-07-14T14:30:00.000Z',
    })
  })

  it('keeps the latest entry date as the default for five minutes', async () => {
    const wrapper = await mountApp()
    vi.useFakeTimers()
    try {
      await wrapper.get('.feed-card input[type="number"]').setValue('120')
      await wrapper.get('.feed-card input[type="date"]').setValue('2026-07-14')
      await wrapper.get('.feed-card input[inputmode="numeric"]').setValue('14:30')
      await wrapper.get('.feed-card').trigger('submit')
      await nextTick()

      expect(wrapper.text()).toContain('120 ml')
      for (const input of wrapper.findAll('.entry-grid input[type="date"]')) {
        expect((input.element as HTMLInputElement).value).toBe('2026-07-14')
      }

      await vi.advanceTimersByTimeAsync(LATEST_ENTRY_DATE_DURATION)

      for (const input of wrapper.findAll('.entry-grid input[type="date"]')) {
        expect((input.element as HTMLInputElement).value).toBe(dateTimeForInput().date)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the latest entry date on reload while its five-minute window is still active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T10:00:00.000Z'))
    try {
      const preloaded: AppData = {
        feeds: [
          {
            id: 'feed-recent',
            amount: 120,
            occurredAt: '2026-07-14T14:30:00.000Z',
            comment: '',
            updatedAt: '2026-07-19T09:58:00.000Z',
          },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      for (const input of wrapper.findAll('.entry-grid input[type="date"]')) {
        expect((input.element as HTMLInputElement).value).toBe('2026-07-14')
      }

      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      for (const input of wrapper.findAll('.entry-grid input[type="date"]')) {
        expect((input.element as HTMLInputElement).value).toBe(dateTimeForInput().date)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not restore stale entry dates on reload after the five-minute window expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T10:00:00.000Z'))
    try {
      const preloaded: AppData = {
        feeds: [
          {
            id: 'feed-stale',
            amount: 120,
            occurredAt: '2026-07-14T14:30:00.000Z',
            comment: '',
            updatedAt: '2026-07-19T09:54:00.000Z',
          },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      for (const input of wrapper.findAll('.entry-grid input[type="date"]')) {
        expect((input.element as HTMLInputElement).value).toBe(dateTimeForInput().date)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the time since the latest bottle and updates it over time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T14:30:00.000Z'))
    try {
      const preloaded: AppData = {
        feeds: [
          {
            id: 'feed-latest',
            amount: 120,
            occurredAt: '2026-07-14T14:30:00.000Z',
            comment: '',
            updatedAt: '2026-07-14T14:30:00.000Z',
          },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      expect(wrapper.text()).toContain('now after the last bottle')
      expect(wrapper.text()).toContain('14 Jul, 14:30')

      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
      await nextTick()

      expect(wrapper.text()).toContain('2 minutes')
    } finally {
      vi.useRealTimers()
    }
  })

  it('formats longer elapsed times as hours and minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T14:30:00.000Z'))
    try {
      const preloaded: AppData = {
        feeds: [
          {
            id: 'feed-long-interval',
            amount: 120,
            occurredAt: '2026-07-14T13:05:00.000Z',
            comment: '',
            updatedAt: '2026-07-14T13:05:00.000Z',
          },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      expect(wrapper.text()).toContain('1 hour and 25 minutes')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a confirmation notification after recording a bottle', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.feed-card input[type="number"]').setValue('120')
    await wrapper.get('.feed-card input[type="date"]').setValue('2026-07-14')
    await wrapper.get('.feed-card input[inputmode="numeric"]').setValue('14:30')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    expect(document.body.textContent).toContain('Bottle recorded')
    expect(document.body.textContent).toContain('120 ml')
    expect(document.body.textContent).toContain('14 Jul, 14:30')
  })

  it('shows a confirmation notification after recording a weight', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.weight-card input[type="number"]').setValue('4.2')
    await wrapper.get('.weight-card input[type="date"]').setValue('2026-07-14')
    await wrapper.get('.weight-card').trigger('submit')
    await flushPromises()
    expect(document.body.textContent).toContain('Weight recorded')
    expect(document.body.textContent).toContain('4.2 kg')
    expect(document.body.textContent).toContain('14 Jul')
    expect(wrapper.find('.weight-card input[inputmode="numeric"]').exists()).toBe(false)

    const stored = await loadData(GUEST_NAMESPACE)
    expect(stored.weights[0]).toMatchObject({
      occurredAt: new Date('2026-07-14T00:00').toISOString(),
    })
  })

  it('calculates the daily estimate from the latest weight', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.weight-card input[type="number"]').setValue('4.2')
    await wrapper.get('.weight-card').trigger('submit')

    expect(wrapper.text()).toContain('620')
    expect(wrapper.text()).toContain('Estimated theoretical daily quantity')
  })

  it('switches all content to French', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.language-button').trigger('click')

    expect(wrapper.text()).toContain('Noter un biberon')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('defaults to French when browser language is French', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-CA'])
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-CA')

    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Noter un biberon')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('falls back to navigator.language when preferred languages are empty', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue([])
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR')

    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Noter un biberon')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('prefers saved language over browser language', async () => {
    localStorage.setItem('new-parents-tool:language', 'en')
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR')

    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Record a bottle')
    expect(document.documentElement.lang).toBe('en')
  })

  it('auto-inserts the colon once minutes start for 24-hour time inputs', async () => {
    const wrapper = await mountApp()

    for (const input of wrapper.findAll('input[inputmode="numeric"]')) {
      await input.setValue('14')
      await flushPromises()
      expect((input.element as HTMLInputElement).value).toBe('14')

      await input.setValue('143')
      await flushPromises()
      expect((input.element as HTMLInputElement).value).toBe('14:3')

      await input.setValue('1430')
      await flushPromises()

      expect(input.attributes('type')).toBe('text')
      expect(input.attributes('inputmode')).toBe('numeric')
      expect(input.attributes('pattern')).toBe('^(?:[01]\\d|2[0-3]):[0-5]\\d$')
      expect(input.attributes('placeholder')).toBe('14:30')
      expect((input.element as HTMLInputElement).value).toBe('14:30')
    }
  })

  it('lists every measure in tabs and saves quick edits', async () => {
    const preloaded: AppData = {
      feeds: [
        { id: 'feed-1', amount: 120, occurredAt: '2026-07-14T14:30:00.000Z', comment: '', updatedAt: '2026-07-14T14:30:00.000Z' },
        { id: 'feed-2', amount: 90, occurredAt: '2026-07-13T14:30:00.000Z', comment: '', updatedAt: '2026-07-13T14:30:00.000Z' },
      ],
      weights: [{ id: 'weight-1', kilograms: 4.2, occurredAt: '2026-07-14T14:30:00.000Z', updatedAt: '2026-07-14T14:30:00.000Z' }],
    }
    await saveData(preloaded, GUEST_NAMESPACE)
    const wrapper = await mountApp()

    expect(wrapper.findAll('.measure-list li')).toHaveLength(2)
    await wrapper.get('.measure-list button').trigger('click')
    expect(wrapper.get('.measure-list form').text()).toContain('Quantity (ml)')
    expect(wrapper.get('.measure-list form').text()).toContain('Date')
    expect(wrapper.get('.measure-list form').text()).toContain('Time (24h)')
    expect(wrapper.get('.measure-list form').text()).toContain('Comment (optional)')
    await wrapper.get('.measure-list input[type="number"]').setValue('150')
    await wrapper.get('#edit-feed-time').setValue('0915')
    await wrapper.get('.measure-list form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('150 ml')

    const stored = await loadData(GUEST_NAMESPACE)
    // The edited feed should be updated (feed-1 is sorted first by date desc)
    const editedFeed = stored.feeds.find((f) => f.id === 'feed-1')
    expect(editedFeed!.amount).toBe(150)
    expect(editedFeed!.occurredAt).toBe('2026-07-14T09:15:00.000Z')

    const weightTab = wrapper.findAll('[role="tab"]')[1]
    expect(weightTab).toBeDefined()
    await weightTab!.trigger('click')
    expect(wrapper.text()).toContain('4.2 kg')
  })

  it('always shows the rolling 24h intake chart where each point sums the trailing 24 hours', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T14:00:00.000Z'))
    try {
      const now = Date.now()
      const preloaded: AppData = {
        feeds: [
          { id: 'feed-today-1', amount: 120, occurredAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(), comment: '', updatedAt: new Date().toISOString() },
          { id: 'feed-today-2', amount: 80, occurredAt: new Date(now - 5 * 60 * 60 * 1000).toISOString(), comment: '', updatedAt: new Date().toISOString() },
          { id: 'feed-yesterday', amount: 150, occurredAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(), comment: '', updatedAt: new Date().toISOString() },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      // Chart is present in the default 7-day view (one point per day).
      expect(wrapper.text()).toContain('Quantity fed (rolling 24h)')
      expect(wrapper.find('.full-width .rolling-intake-chart').exists()).toBe(true)
      expect(wrapper.find('.full-width svg').exists()).toBe(true)
      expect(wrapper.find('.rolling-intake-labels').exists()).toBe(true)
      expect(wrapper.findAll('.rolling-intake-col')).toHaveLength(7)

      // The chart is still shown on the 24 hours range (6 four-hour samples).
      const twentyFourHoursBtn = wrapper
        .findAll('.range-toggle button')
        .find((b) => b.text() === '24 hours')
      await twentyFourHoursBtn!.trigger('click')
      const cols = wrapper.findAll('.rolling-intake-col')
      expect(cols).toHaveLength(6)

      // The final point sums the quantities fed over the trailing 24 hours
      // (120 + 80 = 200), excluding the 26h-old bottle.
      const amounts = wrapper.findAll('.rolling-intake-amount').map((el) => el.text())
      expect(amounts[amounts.length - 1]).toBe('200 ml')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the number of bottles recorded for each day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T14:00:00.000Z'))
    try {
      const preloaded: AppData = {
        feeds: [
          { id: 'feed-today-1', amount: 120, occurredAt: '2026-07-19T12:00:00.000Z', comment: '', updatedAt: '2026-07-19T14:00:00.000Z' },
          { id: 'feed-today-2', amount: 80, occurredAt: '2026-07-19T09:00:00.000Z', comment: '', updatedAt: '2026-07-19T14:00:00.000Z' },
          { id: 'feed-yesterday', amount: 150, occurredAt: '2026-07-18T12:00:00.000Z', comment: '', updatedAt: '2026-07-19T14:00:00.000Z' },
        ],
        weights: [],
      }
      await saveData(preloaded, GUEST_NAMESPACE)
      const wrapper = await mountApp()

      expect(wrapper.text()).toContain('Bottles per day')
      expect(wrapper.find('.bottle-count-chart').attributes('aria-label')).toBe('Bottles per day')
      expect(wrapper.findAll('.bottle-count-chart .bar-value').map((bar) => bar.text())).toEqual(['1', '2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows older bottles when all-time trends are selected', async () => {
    const preloaded: AppData = {
      feeds: [
        {
          id: 'older-feed',
          amount: 120,
          occurredAt: '2026-01-01T12:00:00.000Z',
          comment: '',
          updatedAt: '2026-01-01T12:00:00.000Z',
        },
      ],
      weights: [],
    }
    await saveData(preloaded, GUEST_NAMESPACE)
    const wrapper = await mountApp()

    expect(wrapper.find('.bar-value').exists()).toBe(false)
    const allTimeBtn = wrapper.findAll('.range-toggle button').find((b) => b.text() === 'All time')
    await allTimeBtn!.trigger('click')

    expect(wrapper.find('.bar-value').text()).toBe('120')
  })
  it('opens report options and downloads a PDF report', async () => {
    const preloaded: AppData = {
      feeds: [
        { id: 'feed-1', amount: 120, occurredAt: '2026-07-19T08:00:00.000Z', comment: 'Drank well', updatedAt: '2026-07-19T08:00:00.000Z' },
      ],
      weights: [
        { id: 'weight-1', kilograms: 4.2, occurredAt: '2026-07-19T07:30:00.000Z', updatedAt: '2026-07-19T07:30:00.000Z' },
      ],
    }
    await saveData(preloaded, GUEST_NAMESPACE)
    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Export data')
    expect(wrapper.text()).toContain('Import data')
    expect(wrapper.text()).toContain('Generate report')

    const reportButton = wrapper.findAll('button').find((button) => button.text() === 'Generate report')
    await reportButton!.trigger('click')

    expect(wrapper.text()).toContain('Report options')

    const downloadButton = wrapper.findAll('button').find((button) => button.text() === 'Download PDF')
    await downloadButton!.trigger('click')
    await flushPromises()

    expect(reportPdfSpies.generateReportPdfBlob).toHaveBeenCalledTimes(1)
    expect(reportPdfSpies.downloadPdf).toHaveBeenCalledTimes(1)
    expect(reportPdfSpies.downloadPdf.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(reportPdfSpies.downloadPdf.mock.calls[0]?.[1]).toMatch(
      /^little-sips-report-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.pdf$/,
    )
    expect(document.body.textContent).toContain('Your PDF report is ready.')
  })

  it('shows a toast after exporting data', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:export'),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = await mountApp()

    const exportButton = wrapper.findAll('button').find((button) => button.text() === 'Export data')
    await exportButton!.trigger('click')

    expect(document.body.textContent).toContain('Your data export is ready.')
  })

  it('shows a toast after importing data', async () => {
    const wrapper = await mountApp()
    const importInput = wrapper.get('input[type="file"]')
    const file = new File([JSON.stringify({ feeds: [], weights: [] })], 'little-sips.json', {
      type: 'application/json',
    })
    Object.defineProperty(importInput.element, 'files', { configurable: true, value: [file] })

    await importInput.trigger('change')
    await flushPromises()

    expect(document.body.textContent).toContain('Data imported successfully.')
  })

  it('validates report settings before generating a PDF', async () => {
    const wrapper = await mountApp()
    const reportButton = wrapper.findAll('button').find((button) => button.text() === 'Generate report')
    await reportButton!.trigger('click')

    await wrapper.get('input[value="custom"]').setValue()
    const customDates = wrapper.findAll('.report-custom-range input[type="date"]')
    await customDates[0]!.setValue('2026-07-20')
    await customDates[1]!.setValue('2026-07-19')

    const categoryCheckboxes = wrapper.findAll('.report-fieldset input[type="checkbox"]')
    await categoryCheckboxes[0]!.setValue(false)
    await categoryCheckboxes[1]!.setValue(false)

    const downloadButton = wrapper.findAll('button').find((button) => button.text() === 'Download PDF')
    await downloadButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Select bottle feeds or weight measurements to include.')
    expect(wrapper.text()).toContain('The start date must be on or before the end date.')
    expect(reportPdfSpies.generateReportPdfBlob).not.toHaveBeenCalled()
    expect(reportPdfSpies.downloadPdf).not.toHaveBeenCalled()
  })

})
