import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import App from '@/app/App.vue'
import router from '@/app/router'

describe('app skeleton', () => {
  it('renders the placeholder page through the router', async () => {
    const wrapper = mount(App, { global: { plugins: [router] } })

    await router.isReady()

    expect(wrapper.find('h1').text()).toBe('PostIt')
  })
})
