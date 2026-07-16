import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import App from '../App.vue'
import { STORAGE_KEY } from '../storage'

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
})
