import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import App from '@/App.vue'
import router from '@/router'

describe('app skeleton', () => {
  it('renders the placeholder home page through the router', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })

    await router.isReady()

    expect(wrapper.find('h1.text-2xl.font-bold').text()).toBe('PostIt')
  })
})
