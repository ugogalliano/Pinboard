import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useUIStore } from './uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the sidebar open, no toasts and no modal', () => {
    const ui = useUIStore()

    expect(ui.sidebarOpen).toBe(true)
    expect(ui.toasts).toEqual([])
    expect(ui.activeModal).toBeNull()
  })

  it('addToast returns an id, appends the toast and auto-removes it after 3000ms', () => {
    const ui = useUIStore()

    const id = ui.addToast({ type: 'success', message: 'Board created' })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(ui.toasts).toHaveLength(1)
    expect(ui.toasts[0]).toEqual({ id, type: 'success', message: 'Board created' })

    vi.advanceTimersByTime(2999)
    expect(ui.toasts).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(ui.toasts).toHaveLength(0)
  })

  it('removeToast removes only the matching toast', () => {
    const ui = useUIStore()

    const id1 = ui.addToast({ type: 'info', message: 'one' })
    const id2 = ui.addToast({ type: 'error', message: 'two' })

    ui.removeToast(id1)

    expect(ui.toasts).toHaveLength(1)
    expect(ui.toasts[0]!.id).toBe(id2)
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
