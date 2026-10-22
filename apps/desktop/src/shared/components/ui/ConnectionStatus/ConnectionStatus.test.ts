import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, type Ref } from 'vue'

import ConnectionStatus from './ConnectionStatus.vue'
import type { NoteDto } from '@/shared/types/api'
import { boardConnectionState, type BoardConnectionState } from '@/shared/services/signalr'

// The transport is mocked wholesale (AGENTS §6): the component consumes the
// state through useBoardConnectionState(), which forwards the service's
// module-level ref — so the tests swap THAT ref's value via the mocked module
// import below. The factory is async to obtain a REAL reactive ref (a plain
// { value } stand-in would never trigger the component's watcher).
vi.mock('@/shared/services/signalr', async () => {
  const { ref } = await import('vue')
  return {
    boardConnectionState: ref('Disconnected'),
    connectBoardHub: vi.fn<() => Promise<void>>(async () => {}),
    joinBoard: vi.fn<(boardId: string) => Promise<void>>(async () => {}),
    leaveBoard: vi.fn<(boardId: string) => Promise<void>>(async () => {}),
    stopBoardHub: vi.fn<() => Promise<void>>(async () => {}),
    onNoteCreated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
    offNoteCreated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
    onNoteUpdated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
    offNoteUpdated: vi.fn<(listener: (note: NoteDto) => void) => void>(),
    onNoteDeleted: vi.fn<(listener: (noteId: string) => void) => void>(),
    offNoteDeleted: vi.fn<(listener: (noteId: string) => void) => void>(),
  }
})

// The mocked module IS what the component graph sees — same ref instance.
const mockState = boardConnectionState as unknown as Ref<BoardConnectionState>

async function setState(value: BoardConnectionState): Promise<void> {
  mockState.value = value
  await nextTick()
}

describe('ConnectionStatus', () => {
  beforeEach(() => {
    mockState.value = 'Disconnected'
  })

  it('renders nothing while Connected', async () => {
    await setState('Connected')
    const wrapper = mount(ConnectionStatus)

    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)
  })

  it('stays hidden on the initial Disconnected/Connecting before the first connect', async () => {
    const wrapper = mount(ConnectionStatus)

    await setState('Connecting')
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)

    await setState('Disconnected')
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)
  })

  it('shows the amber Reconnecting variant after a Connected→Reconnecting transition', async () => {
    await setState('Connected')
    const wrapper = mount(ConnectionStatus)
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)

    await setState('Reconnecting')

    const status = wrapper.get('[data-testid="connection-status"]')
    expect(status.attributes('role')).toBe('status')
    expect(status.text()).toBe('Reconnecting…')
    expect(wrapper.get('[data-testid="connection-status-dot"]').classes()).toContain('bg-amber-500')
  })

  it('hides again once the connection is restored', async () => {
    await setState('Connected')
    const wrapper = mount(ConnectionStatus)
    await setState('Reconnecting')
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(true)

    await setState('Connected')
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)
  })

  it('shows the red Disconnected variant after having connected', async () => {
    await setState('Connected')
    const wrapper = mount(ConnectionStatus)

    await setState('Disconnected')

    expect(wrapper.get('[data-testid="connection-status"]').text()).toBe('Disconnected')
    expect(wrapper.get('[data-testid="connection-status-dot"]').classes()).toContain(
      'bg-destructive',
    )
  })

  it('shows the muted Connecting variant after having connected', async () => {
    await setState('Connected')
    const wrapper = mount(ConnectionStatus)

    await setState('Connecting')

    expect(wrapper.get('[data-testid="connection-status"]').text()).toBe('Connecting…')
    expect(wrapper.get('[data-testid="connection-status-dot"]').classes()).toContain(
      'bg-muted-foreground',
    )
  })

  it('shows Reconnecting when mounted mid-retry (remount while the shared connection churns)', async () => {
    await setState('Reconnecting')
    const wrapper = mount(ConnectionStatus)

    // immediate watcher: 'Reconnecting' implies a past successful connect.
    expect(wrapper.get('[data-testid="connection-status"]').text()).toBe('Reconnecting…')

    // …and the loss is still reported after the retry fails outright.
    await setState('Disconnected')
    expect(wrapper.get('[data-testid="connection-status"]').text()).toBe('Disconnected')
  })
})
