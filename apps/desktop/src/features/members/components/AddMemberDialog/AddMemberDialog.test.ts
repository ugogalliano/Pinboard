import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import AddMemberDialog from './AddMemberDialog.vue'
import { useAuthStore } from '@/stores/authStore'
import { membersKeys } from '@/features/members'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../../test/msw/server'
import { requestLog } from '../../../../../test/msw/requests'

const BOARD = 'b1'
const MEMBERS_URL = API_URLS.members.list(BOARD)

function membership(role: 'Owner' | 'Viewer') {
  return {
    userId: 'u1',
    email: 'u1@example.com',
    displayName: 'Ada Lovelace',
    role,
    createdAt: '2026-02-03T00:00:00Z',
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 40))
}

describe('AddMemberDialog', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    useAuthStore().setTokens({
      accessToken: 'access-live',
      refreshToken: 'refresh-live',
      expiresAt: '2026-01-01T00:00:00Z',
    })
    useAuthStore().setUser({ id: 'u1', email: 'u1@example.com', displayName: 'Ada Lovelace' })
    useToast().clear()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountDialog(open = true, onUpdateOpen = vi.fn<(value: boolean) => void>()) {
    return mount(AddMemberDialog, {
      props: { boardId: BOARD, open, 'onUpdate:open': onUpdateOpen },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
      attachTo: document.body,
    })
  }

  it('submits a valid editor invite and emits update:open false', async () => {
    let body: unknown
    server.use(
      http.get(MEMBERS_URL, () => HttpResponse.json([membership('Owner')])),
      http.post(MEMBERS_URL, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          userId: 'u2',
          email: 'grace@example.com',
          displayName: 'Grace Hopper',
          role: 'Editor',
          createdAt: '2026-02-03T00:00:00Z',
        })
      }),
    )
    const onUpdateOpen = vi.fn<(value: boolean) => void>()
    mountDialog(true, onUpdateOpen)
    await settle()

    const email = document.querySelector<HTMLInputElement>('#add-member-email')!
    email.value = 'grace@example.com'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="add-member-submit"]')!.click()
    await settle()

    expect(body).toEqual({ email: 'grace@example.com', role: 'Editor' })
    expect(onUpdateOpen).toHaveBeenCalledWith(false)
    expect(document.querySelector('#add-member-email-error')).toBeNull()
  })

  it.each([
    { email: 'not-an-email', role: 'Editor', field: 'email' },
    { email: 'grace@example.com', role: 'Owner', field: 'role' },
  ])('rejects invalid $field without issuing POST', async ({ email, role, field }) => {
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json([membership('Owner')])))
    mountDialog()
    await settle()

    const emailInput = document.querySelector<HTMLInputElement>('#add-member-email')!
    emailInput.value = email
    emailInput.dispatchEvent(new Event('input', { bubbles: true }))
    const roleSelect = document.querySelector<HTMLSelectElement>('#add-member-role')!
    roleSelect.add(new Option('Owner', 'Owner'))
    roleSelect.value = role
    roleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="add-member-submit"]')!.click()
    await settle()

    expect(requestLog.filter((entry) => entry.method === 'POST')).toHaveLength(0)
    const errorSelector =
      field === 'email' ? '#add-member-email-error' : `[data-testid="add-member-${field}-error"]`
    expect(document.querySelector(errorSelector)?.textContent).toBe(
      field === 'email' ? 'Enter a valid email address' : 'Role must be Editor or Viewer',
    )
  })

  it('shows safe actionable conflict feedback without an unhandled rejection or extra toast', async () => {
    server.use(
      http.get(MEMBERS_URL, () => HttpResponse.json([membership('Owner')])),
      http.post(MEMBERS_URL, () =>
        HttpResponse.json({ status: 409 }, { status: 409 }),
      ),
    )
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    mountDialog()
    await settle()
    const email = document.querySelector<HTMLInputElement>('#add-member-email')!
    email.value = 'grace@example.com'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-testid="add-member-submit"]')!.click()
    await settle()

    expect(unhandled).toEqual([])
    expect(document.querySelector('[data-testid="add-member-error"]')?.textContent).toContain(
      'Check whether this email is already a board member',
    )
    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]?.message).toBe('This action conflicts with current state')
    window.removeEventListener('unhandledrejection', onUnhandled)
  })

  it('emits closure on cancel and starts each new opening with a clean form', async () => {
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json([membership('Owner')])))
    const onUpdateOpen = vi.fn<(value: boolean) => void>()
    const wrapper = mountDialog(true, onUpdateOpen)
    await settle()

    document.querySelector<HTMLButtonElement>('[data-testid="cancel-add-member"]')!.click()
    await flushPromises()
    expect(onUpdateOpen).toHaveBeenCalledWith(false)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.querySelector<HTMLInputElement>('#add-member-email')?.value).toBe('')
  })

  it('closes and refuses an invite after the role refetch changes Owner to Viewer', async () => {
    let memberReads = 0
    let addRequests = 0
    server.use(
      http.get(MEMBERS_URL, () => {
        memberReads += 1
        return HttpResponse.json([membership(memberReads === 1 ? 'Owner' : 'Viewer')])
      }),
      http.post(MEMBERS_URL, () => {
        addRequests += 1
        return HttpResponse.json({
          userId: 'u2',
          email: 'grace@example.com',
          displayName: 'Grace Hopper',
          role: 'Editor',
          createdAt: '2026-02-03T00:00:00Z',
        })
      }),
    )
    mountDialog(true)
    await settle()
    const email = document.querySelector<HTMLInputElement>('#add-member-email')!
    email.value = 'grace@example.com'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    await queryClient.invalidateQueries({ queryKey: membersKeys.list(BOARD), exact: true })
    await settle()

    const submit = document.querySelector<HTMLButtonElement>('[data-testid="add-member-submit"]')
    submit?.click()
    await settle()

    expect(memberReads).toBe(2)
    expect(document.querySelector('#add-member-email')).toBeNull()
    expect(addRequests).toBe(0)
  })
})
