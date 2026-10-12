import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import AuthLayout from './AuthLayout.vue'

describe('AuthLayout', () => {
  it('renders the brand (mark + wordmark + tagline) and the RouterView outlet', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/login',
          component: AuthLayout,
          children: [{ path: '', component: { template: '<div>form-outlet</div>' } }],
        },
      ],
    })
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(AuthLayout, { global: { plugins: [router] } })

    // Brand block per the "01 Login" frame: P mark, wordmark, tagline.
    expect(wrapper.text()).toContain('P')
    expect(wrapper.find('h1').text()).toBe('PostIt')
    expect(wrapper.text()).toContain('The collaborative board for your team.')
    // The routed form renders inside the card.
    expect(wrapper.text()).toContain('form-outlet')
  })
})
