import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { useToast } from '@ugogalliano/pm-design-system-vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import CreateBoardDialog from './CreateBoardDialog.vue'
import BoardList from './BoardList.vue'
import type { BoardDto } from '@/shared/types/api'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

// The jsonResponse helper is duplicated per test file on purpose: a shared
// src/test-utils module would ship in the production bundle.
function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text === '' ? undefined : JSON.parse(text)),
  } as unknown as Response
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

/** BoardList renders RouterLinks, so the mounted host always needs a router. */
async function stubRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/boards/:boardId', name: 'board-canvas', component: { template: '<div/>' } },
      { path: '/', component: { template: '<div/>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

function nameInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#create-board-name')!
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('[data-testid="create-board-submit"]')!
}

/** Types into the teleported DS Input and submits the dialog. */
async function fillAndSubmit(value: string): Promise<void> {
  const input = nameInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  submitButton().click()
  await settle()
}

describe('CreateBoardDialog', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useToast().clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  function mountDialog(open = true) {
    return mount(CreateBoardDialog, {
      props: { open },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    })
  }

  it('renders nothing while closed', () => {
    mountDialog(false)
    expect(nameInput()).toBeNull()
  })

  it('rejects a name over 200 characters inline without calling the API', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    mountDialog()
    await flushPromises()

    await fillAndSubmit('x'.repeat(201))

    expect(fetchMock).not.toHaveBeenCalled()
    const error = document.querySelector('#create-board-name-error')
    expect(error).not.toBeNull()
    expect(error!.textContent).toContain('at most 200 characters')
  })

  it('posts the name, closes the dialog and refetches the board list', async () => {
    const created: BoardDto = {
      id: 'b9',
      name: 'Roadmap',
      createdBy: 'u1',
      createdAt: '2026-02-03T00:00:00Z',
      updatedAt: '2026-02-03T00:00:00Z',
    }
    const stored: BoardDto[] = []
    let postBody: unknown

    const fetchMock = vi.fn<FetchImpl>(async (_url, init) => {
      if ((init?.method ?? 'GET') === 'POST') {
        postBody = JSON.parse(String(init?.body))
        stored.push(created)
        return jsonResponse(200, created)
      }
      return jsonResponse(200, stored)
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(BoardList, {
      global: { plugins: [await stubRouter(), [VueQueryPlugin, { queryClient }]] },
    })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.find('[data-testid="create-board"]').trigger('click')
    await flushPromises()
    await fillAndSubmit('Roadmap')

    expect(postBody).toEqual({ name: 'Roadmap' })
    // Invalidation refetched the list, which now serves the new board.
    const listGets = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/boards' && (init?.method ?? 'GET') === 'GET',
    )
    expect(listGets).toHaveLength(2)
    expect(nameInput()).toBeNull()
    expect(wrapper.findAll('[data-testid="board-card"]')).toHaveLength(1)
  })

  it('renders a server 400 detail as a form-level message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(400, { status: 400, detail: 'Name is taken' })),
    )

    mountDialog()
    await flushPromises()
    await fillAndSubmit('Roadmap')

    const alert = document.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toBe('Invalid input: Name is taken')
    // Board endpoints carry no `errors` dictionary — nothing is field-mapped,
    // and the dialog stays open for a retry.
    expect(nameInput()).not.toBeNull()
    expect(document.querySelector('#create-board-name-error')).toBeNull()
  })

  it('surfaces unexpected failures as an error toast and keeps the dialog open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(500, { status: 500, title: 'Boom' })),
    )

    mountDialog()
    await flushPromises()
    await fillAndSubmit('Roadmap')

    const toasts = useToast().toasts.value
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.variant).toBe('error')
    expect(toasts[0]!.message).toBe('Something went wrong. Please try again.')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(nameInput()).not.toBeNull()
  })
})
