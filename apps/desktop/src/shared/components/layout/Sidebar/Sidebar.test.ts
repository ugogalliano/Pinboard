import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import Sidebar from './Sidebar.vue'
import { useUIStore } from '@/stores/uiStore'

function mountSidebar() {
  return mount(Sidebar, {
    slots: { default: '<ul data-testid="nav-list"><li>boards</li></ul>' },
  })
}

describe('Sidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the nav slot and exposes the open state to assistive tech', () => {
    const wrapper = mountSidebar()

    expect(wrapper.find('[data-testid="nav-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sidebar-toggle"]').attributes('aria-expanded')).toBe('true')
  })

  it('collapses to a narrow rail, hiding the nav but keeping the toggle reachable', async () => {
    const wrapper = mountSidebar()

    await wrapper.find('[data-testid="sidebar-toggle"]').trigger('click')

    expect(useUIStore().sidebarOpen).toBe(false)
    expect(wrapper.find('[data-testid="nav-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-toggle"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="sidebar-toggle"]').text()).toContain('Expand')

    // Re-opening brings the nav back.
    await wrapper.find('[data-testid="sidebar-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="nav-list"]').exists()).toBe(true)
  })
})
