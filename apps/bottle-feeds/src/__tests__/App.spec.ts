import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import memoryDriver from 'unstorage/drivers/memory'

import App from '../App.vue'
import { loadData, saveData, _setTestDriver, GUEST_NAMESPACE, STORAGE_KEY } from '../storage'
import type { AppData } from '../types'

// Silence storage-related console warnings in tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  beforeEach(() => {
    _setTestDriver(memoryDriver())
    localStorage.clear()
    vi.stubGlobal('crypto', { randomUUID: () => 'test-id' })
  })

  afterEach(() => {
    _setTestDriver(null)
  })

  const mountApp = async () => {
    const wrapper = mount(App, {
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

  it('calculates the daily estimate from the latest weight', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.weight-card input[type="number"]').setValue('4.2')
    await wrapper.get('.weight-card').trigger('submit')

    expect(wrapper.text()).toContain('630')
    expect(wrapper.text()).toContain('Estimated daily maximum')
  })

  it('switches all content to French', async () => {
    const wrapper = await mountApp()

    await wrapper.get('.language-button').trigger('click')

    expect(wrapper.text()).toContain('Noter un biberon')
    expect(document.documentElement.lang).toBe('fr')
  })

  it('uses keyboard-friendly 24-hour time inputs', async () => {
    const wrapper = await mountApp()

    for (const input of wrapper.findAll('input[inputmode="numeric"]')) {
      expect(input.attributes('type')).toBe('text')
      expect(input.attributes('pattern')).toBe('^(?:[01]\\d|2[0-3]):[0-5]\\d$')
      expect(input.attributes('placeholder')).toBe('14:30')
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
    await wrapper.get('.measure-list form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('150 ml')

    const stored = await loadData(GUEST_NAMESPACE)
    // The edited feed should be updated (feed-1 is sorted first by date desc)
    const editedFeed = stored.feeds.find((f) => f.id === 'feed-1')
    expect(editedFeed!.amount).toBe(150)

    const weightTab = wrapper.findAll('[role="tab"]')[1]
    expect(weightTab).toBeDefined()
    await weightTab!.trigger('click')
    expect(wrapper.text()).toContain('4.2 kg')

    // Suppress STORAGE_KEY usage warning: it's only for legacy reference
    void STORAGE_KEY
  })
})
