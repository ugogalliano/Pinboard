import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import ErrorFallback from './ErrorFallback.vue'

describe('ErrorFallback', () => {
  it('renders the safe message inside an alert region', () => {
    const wrapper = mount(ErrorFallback, {
      props: { message: "You don't have permission for this action" },
    })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe("You don't have permission for this action")
  })

  it('defaults the title to "Something went wrong" and accepts a custom one', () => {
    const withDefault = mount(ErrorFallback, { props: { message: 'Boom' } })
    expect(withDefault.get('[data-testid="error-fallback-title"]').text()).toBe(
      'Something went wrong',
    )

    const withCustom = mount(ErrorFallback, {
      props: { title: 'Unable to open the board', message: 'Boom' },
    })
    expect(withCustom.get('[data-testid="error-fallback-title"]').text()).toBe(
      'Unable to open the board',
    )
  })

  it('the single Try again button emits retry exactly once', async () => {
    const wrapper = mount(ErrorFallback, { props: { message: 'Boom' } })

    expect(wrapper.findAll('button')).toHaveLength(1)

    await wrapper.get('[data-testid="error-fallback-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
