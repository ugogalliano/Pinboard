import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { type Ref } from 'vue'

import BoardView from './BoardView.vue'
import ConnectionStatus from '@/shared/components/ui/ConnectionStatus/ConnectionStatus.vue'
import type { NoteDto } from '@/shared/types/api'
import { boardConnectionState, type BoardConnectionState } from '@/shared/services/signalr'

// Phase 7: the board shell mounts the connection indicator. The transport is
// mocked with a REAL reactive ref so the indicator's watcher sees transitions
// (same pattern as ConnectionStatus.test.ts).
vi.mock('@/shared/services/signalr', async () => {
  const { ref } = await import('vue')
  return {
    boardConnectionState: ref('Connected'),
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

const mockState = boardConnectionState as unknown as Ref<BoardConnectionState>

const BOARD = 'b1'

describe('BoardView', () => {
  beforeEach(() => {
    mockState.value = 'Connected'
  })

  /** Mounts the shell behind a real `/boards/:boardId` route; BoardHeader is
   *  stubbed because its data flow is covered by its own suite. */
  async function mountShell() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/boards/:boardId',
          name: 'board-canvas',
          component: { template: '<div data-testid="canvas-stub" />' },
        },
      ],
    })
    await router.push(`/boards/${BOARD}`)
    await router.isReady()

    return mount(BoardView, {
      global: {
        plugins: [router],
        stubs: { BoardHeader: true },
      },
    })
  }

  it('renders the connection indicator inside the board shell (above the outlet)', async () => {
    // A connection loss is what makes the indicator visible.
    mockState.value = 'Reconnecting'
    const wrapper = await mountShell()
    await flushPromises()

    expect(wrapper.findComponent(ConnectionStatus).exists()).toBe(true)
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="connection-status"]').text()).toBe('Reconnecting…')
  })

  it('keeps the indicator mounted (invisible) while Connected', async () => {
    const wrapper = await mountShell()
    await flushPromises()

    expect(wrapper.findComponent(ConnectionStatus).exists()).toBe(true)
    expect(wrapper.find('[data-testid="connection-status"]').exists()).toBe(false)
  })
})
