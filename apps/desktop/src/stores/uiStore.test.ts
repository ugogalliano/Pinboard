import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useUIStore } from './uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with the sidebar open and no modal', () => {
    const ui = useUIStore()

    expect(ui.sidebarOpen).toBe(true)
    expect(ui.activeModal).toBeNull()
  })

  it('toggleSidebar flips the state', () => {
    const ui = useUIStore()

    ui.toggleSidebar()
    expect(ui.sidebarOpen).toBe(false)

    ui.toggleSidebar()
    expect(ui.sidebarOpen).toBe(true)
  })

  it('openModal/closeModal set and clear the active modal', () => {
    const ui = useUIStore()

    ui.openModal('create-board')
    expect(ui.activeModal).toBe('create-board')

    ui.closeModal()
    expect(ui.activeModal).toBeNull()
  })
})
