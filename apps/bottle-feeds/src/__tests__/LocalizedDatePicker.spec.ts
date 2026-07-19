import { expect, it } from 'vite-plus/test'
import { shallowMount } from '@vue/test-utils'
import UCalendar from '@nuxt/ui/components/Calendar.vue'
import UInputDate from '@nuxt/ui/components/InputDate.vue'

import LocalizedDatePicker from '../components/LocalizedDatePicker.vue'

it('passes the selected locale to the date field and calendar', () => {
  const wrapper = shallowMount(LocalizedDatePicker, {
    props: {
      locale: 'fr-FR',
      modelValue: '2026-07-19',
    },
    global: {
      stubs: {
        UPopover: {
          template: '<div><slot /><slot name="content" /></div>',
        },
      },
    },
  })

  expect(wrapper.findComponent(UInputDate).props('locale')).toBe('fr-FR')
  expect(wrapper.findComponent(UCalendar).props('locale')).toBe('fr-FR')
})
