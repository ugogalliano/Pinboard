import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import Spinner from './Spinner.vue'

describe('Spinner', () => {
  it('announces the loading state and keeps the ring decorative', () => {
    const wrapper = mount(Spinner)

    // role="status" (implicit aria-live="polite") carries the label.
    expect(wrapper.get('[role="status"]').text()).toBe('Loading…')
    expect(wrapper.find('[aria-hidden="true"]').exists()).toBe(true)
  })

  it('accepts a custom label and applies the size class to the ring', () => {
    const wrapper = mount(Spinner, { props: { label: 'Loading boards…', sizeClass: 'h-8 w-8' } })

    expect(wrapper.get('[role="status"]').text()).toBe('Loading boards…')
    const ring = wrapper.get('[aria-hidden="true"]')
    expect(ring.classes()).toContain('h-8')
    expect(ring.classes()).toContain('w-8')
  })
})
