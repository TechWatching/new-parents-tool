import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import App from '../App.vue'
import { STORAGE_KEY } from '../storage'

vi.mock('../ocr', () => ({
  extractTextFromImage: vi.fn<(image: Blob | File) => Promise<string>>(),
  parseFirstNumber: (text: string) => {
    const match = text.match(/\d+(?:[.,]\d+)?/)
    return match ? Number(match[0].replace(',', '.')) : null
  },
}))

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'test-id' })
  })

  it('records a bottle and persists it locally', async () => {
    const wrapper = mount(App)

    await wrapper.get('.feed-card input[type="number"]').setValue('120')
    await wrapper.get('.feed-card input[type="text"]').setValue('Drank well')
    await wrapper.get('.feed-card').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('120 ml')
    expect(wrapper.text()).toContain('Drank well')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').feeds).toHaveLength(1)
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
    const { extractTextFromImage } = await import('../ocr')
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
    const { extractTextFromImage } = await import('../ocr')
    vi.mocked(extractTextFromImage).mockResolvedValue('no digits here')

    const wrapper = mount(App)
    const input = wrapper.get('.weight-card input[type="file"]')
    const file = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not read a number from that photo')
  })
})

