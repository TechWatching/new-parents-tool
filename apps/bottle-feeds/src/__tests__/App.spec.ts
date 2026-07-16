import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { flushPromises, mount } from '@vue/test-utils'

import App from '../App.vue'
import { STORAGE_KEY } from '../storage'

vi.mock('../ocr', () => ({
  extractTextFromImage: vi.fn(),
  parseFeedEntries: vi.fn(),
  parseFirstNumber: vi.fn(),
}))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'test-id' })
  })

  it('records a bottle and persists it locally', async () => {
    const wrapper = mount(App)

    await wrapper.get('.feed-card input[type="number"]').setValue('120')
    await wrapper.get('.feed-card input[type="date"]').setValue('2026-07-14')
    await wrapper.get('.feed-card input[inputmode="numeric"]').setValue('14:30')
    await wrapper.get('.feed-card input[maxlength="160"]').setValue('Drank well')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('120 ml')
    expect(wrapper.text()).toContain('Drank well')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').feeds[0]).toMatchObject({
      occurredAt: '2026-07-14T14:30:00.000Z',
    })
  })

  it('calculates the daily estimate from the latest weight', async () => {
    const wrapper = mount(App)

    await wrapper.get('.weight-card input[type="number"]').setValue('4.2')
    await wrapper.get('.weight-card').trigger('submit')

    expect(wrapper.text()).toContain('630')
    expect(wrapper.text()).toContain('Estimated daily maximum')
  })

  it('switches all content to French', async () => {
    const wrapper = mount(App)

    await wrapper.get('.language-button').trigger('click')

    expect(wrapper.text()).toContain('Noter un biberon')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('uses keyboard-friendly 24-hour time inputs', () => {
    const wrapper = mount(App)

    for (const input of wrapper.findAll('input[inputmode="numeric"]')) {
      expect(input.attributes('type')).toBe('text')
      expect(input.attributes('pattern')).toBe('^(?:[01]\\d|2[0-3]):[0-5]\\d$')
      expect(input.attributes('placeholder')).toBe('14:30')
    }
  })

  it('edits an existing bottle entry instead of creating a new one', async () => {
    const wrapper = mount(App)

    await wrapper.get('.feed-card input[type="number"]').setValue('120')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    await wrapper.get('.history-card .edit-button').trigger('click')
    await wrapper.get('.feed-card input[type="number"]').setValue('150')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    const feeds = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').feeds
    expect(feeds).toHaveLength(1)
    expect(feeds[0].amount).toBe(150)
    expect(wrapper.text()).toContain('150 ml')
    expect(wrapper.text()).not.toContain('120 ml')
  })

  it('edits an existing weight entry instead of creating a new one', async () => {
    const wrapper = mount(App)

    await wrapper.get('.weight-card input[type="number"]').setValue('4.2')
    await wrapper.get('.weight-card').trigger('submit')
    await flushPromises()

    await wrapper.get('.history-card:nth-of-type(2) .edit-button').trigger('click')
    await wrapper.get('.weight-card input[type="number"]').setValue('4.5')
    await wrapper.get('.weight-card').trigger('submit')
    await flushPromises()

    const weights = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').weights
    expect(weights).toHaveLength(1)
    expect(weights[0].kilograms).toBe(4.5)
  })

  it('fills the feed amount from a scanned photo', async () => {
    const { extractTextFromImage, parseFeedEntries } = await import('../ocr')
    vi.mocked(parseFeedEntries).mockReturnValue([
      { amount: 120, occurredAt: '2026-07-14T15:00:00.000Z' },
    ])
    vi.mocked(extractTextFromImage).mockResolvedValue('120 ml at 3pm')

    const wrapper = mount(App)
    const input = wrapper.get('.feed-card input[type="file"]')
    const file = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(extractTextFromImage).toHaveBeenCalledWith(file)
    expect((wrapper.get('.feed-card input[type="number"]').element as HTMLInputElement).value).toBe(
      '120',
    )
  })

  it('shows an error when the scanned photo has no readable number', async () => {
    const { extractTextFromImage, parseFirstNumber } = await import('../ocr')
    vi.mocked(parseFirstNumber).mockReturnValue(null)
    vi.mocked(extractTextFromImage).mockResolvedValue('no digits here')

    const wrapper = mount(App)
    const input = wrapper.get('.weight-card input[type="file"]')
    const file = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not read a number from that photo')
  })

  it('adds every recognized bottle when the photo has several handwritten lines', async () => {
    const { extractTextFromImage, parseFeedEntries } = await import('../ocr')
    vi.mocked(parseFeedEntries).mockReturnValue([
      { amount: 40, occurredAt: '2026-07-14T01:45:00.000Z' },
      { amount: 120, occurredAt: '2026-07-14T08:30:00.000Z' },
      { amount: 90, occurredAt: '2026-07-14T12:00:00.000Z' },
    ])
    vi.mocked(extractTextFromImage).mockResolvedValue('1h45 -> 40\n8:30 - 120ml\n12h 90')

    const wrapper = mount(App)
    const input = wrapper.get('.feed-card input[type="file"]')
    const file = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const feeds = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').feeds
    expect(feeds).toHaveLength(3)
    expect(
      feeds.map((feed: { amount: number }) => feed.amount).sort((a: number, b: number) => a - b),
    ).toEqual([40, 90, 120])
    expect(wrapper.text()).toContain('Added 3 bottles from the photo')
  })
})
