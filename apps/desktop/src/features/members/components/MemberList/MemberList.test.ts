import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { http, HttpResponse } from 'msw'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import MemberList from './MemberList.vue'
import RoleSelect from '../RoleSelect/RoleSelect.vue'
import { useAuthStore } from '@/stores/authStore'
import { API_URLS } from '@/shared/constants/urls'
import { membersKeys } from '@/features/members'
import type { BoardMemberDto, BoardRole } from '@/shared/types/api'
import { server } from '../../../../../test/msw/server'
import { requestLog } from '../../../../../test/msw/requests'

const BOARD = 'b1'
const MEMBERS_URL = API_URLS.members.list(BOARD)

function member(
  userId: string,
  role: BoardRole,
  overrides: Partial<BoardMemberDto> = {},
): BoardMemberDto {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId === 'u1' ? 'Ada Lovelace' : 'Grace Hopper',
    role,
    createdAt: '2026-02-03T00:00:00Z',
    ...overrides,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 40))
}

async function click(selector: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(selector)!.click()
  await settle()
}

describe('MemberList', () => {
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

  function mountList() {
    return mount(MemberList, {
      props: { boardId: BOARD },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
      attachTo: document.body,
    })
  }

  it('shows loading, then an empty state for an empty board', async () => {
    server.use(http.get(MEMBERS_URL, () => HttpResponse.json([])))
    const wrapper = mountList()

    expect(wrapper.find('[data-testid="members-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(false)
    await settle()

    expect(wrapper.find('[data-testid="members-empty"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No members yet')
  })

  it('hides management controls while the initial members query is pending', async () => {
    let resolveResponse!: () => void
    const responseGate = new Promise<void>((resolve) => {
      resolveResponse = resolve
    })
    server.use(
      http.get(MEMBERS_URL, async () => {
        await responseGate
        return HttpResponse.json([member('u1', 'Owner'), member('u2', 'Editor')])
      }),
    )
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.find('[data-testid="members-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-member-u2"]').exists()).toBe(false)

    resolveResponse()
    await settle()
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(true)
  })

  it('fails closed during a failed refetch with cached Owner data', async () => {
    const cachedMembers = [member('u1', 'Owner'), member('u2', 'Editor')]
    queryClient.setQueryData(membersKeys.list(BOARD), cachedMembers)

    let resolveResponse!: () => void
    const responseGate = new Promise<void>((resolve) => {
      resolveResponse = resolve
    })
    server.use(
      http.get(MEMBERS_URL, async () => {
        await responseGate
        return HttpResponse.json({ status: 500 }, { status: 500 })
      }),
    )
    const wrapper = mountList()
    await flushPromises()

    // Cached rows remain visible while the refetch is in flight, but their
    // stale Owner role must not grant any management affordances.
    expect(wrapper.find('[data-testid="member-u2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-member-u2"]').exists()).toBe(false)

    resolveResponse()
    await settle()

    expect(wrapper.find('[data-testid="members-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-member-u2"]').exists()).toBe(false)
    expect(queryClient.getQueryData(membersKeys.list(BOARD))).toEqual(cachedMembers)
  })

  it('hides role controls and sends no PUT while the Owner role is being refetched', async () => {
    let memberReads = 0
    let resolveRefetch!: () => void
    const refetchGate = new Promise<void>((resolve) => {
      resolveRefetch = resolve
    })
    let putRequests = 0
    server.use(
      http.get(MEMBERS_URL, async () => {
        memberReads += 1
        if (memberReads > 1) await refetchGate
        return HttpResponse.json([member('u1', memberReads === 1 ? 'Owner' : 'Viewer'), member('u2', 'Editor')])
      }),
      http.put(API_URLS.members.detail(BOARD, 'u2'), () => {
        putRequests += 1
        return HttpResponse.json(member('u2', 'Viewer'))
      }),
    )
    const wrapper = mountList()
    await settle()
    expect(wrapper.findComponent(RoleSelect).exists()).toBe(true)

    const refetch = queryClient.invalidateQueries({ queryKey: membersKeys.list(BOARD), exact: true })
    await flushPromises()
    expect(queryClient.isFetching({ queryKey: membersKeys.list(BOARD), exact: true })).toBe(1)
    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
    expect(putRequests).toBe(0)
    resolveRefetch()
    await refetch
    await settle()

    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
    expect(putRequests).toBe(0)
  })

  it('closes an open remove confirmation and refuses DELETE after the role refetch errors', async () => {
    let memberReads = 0
    let deleteRequests = 0
    server.use(
      http.get(MEMBERS_URL, () => {
        memberReads += 1
        return memberReads === 1
          ? HttpResponse.json([member('u1', 'Owner'), member('u2', 'Editor')])
          : HttpResponse.json({ status: 500 }, { status: 500 })
      }),
      http.delete(API_URLS.members.detail(BOARD, 'u2'), () => {
        deleteRequests += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const wrapper = mountList()
    await settle()
    await wrapper.find('[data-testid="remove-member-u2"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-testid="confirm-remove-member"]')).not.toBeNull()

    await queryClient.invalidateQueries({ queryKey: membersKeys.list(BOARD), exact: true })
    await settle()
    document.querySelector<HTMLButtonElement>('[data-testid="confirm-remove-member"]')?.click()
    await settle()

    expect(memberReads).toBe(2)
    expect(wrapper.find('[data-testid="members-error"]').exists()).toBe(true)
    expect(document.querySelector('[data-testid="confirm-remove-member"]')).toBeNull()
    expect(deleteRequests).toBe(0)
  })

  it('renders query error with a retry affordance and recovers', async () => {
    let attempts = 0
    server.use(
      http.get(MEMBERS_URL, () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.json({ status: 500 }, { status: 500 })
          : HttpResponse.json([member('u1', 'Owner')])
      }),
    )
    const wrapper = mountList()
    await settle()

    expect(wrapper.find('[data-testid="members-error"]').exists()).toBe(true)
    await wrapper.find('[data-testid="members-retry"]').trigger('click')
    await settle()

    expect(attempts).toBe(2)
    expect(wrapper.find('[data-testid="member-u1"]').exists()).toBe(true)
  })

  it('shows member identity and Owner-only controls, but never controls an Owner row', async () => {
    server.use(
      http.get(MEMBERS_URL, () =>
        HttpResponse.json([
          member('u1', 'Owner'),
          member('u2', 'Editor', { email: 'grace@example.com', displayName: 'Grace Hopper' }),
        ]),
      ),
    )
    const wrapper = mountList()
    await settle()

    expect(wrapper.text()).toContain('Ada Lovelace')
    expect(wrapper.text()).toContain('grace@example.com')
    expect(wrapper.find('[data-testid="role-select-u1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="remove-member-u1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="remove-member-u2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(true)
  })

  it.each(['Editor', 'Viewer'] as const)(
    'hides all membership actions for a current %s',
    async (role) => {
      server.use(
        http.get(MEMBERS_URL, () =>
          HttpResponse.json([member('u1', role), member('u2', 'Owner')]),
        ),
      )
      const wrapper = mountList()
      await settle()

      expect(wrapper.find('[data-testid="add-member"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="role-select-u1"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="remove-member-u1"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="role-select-u2"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="remove-member-u2"]').exists()).toBe(false)
    },
  )

  it('confirms removal, sends no request on cancel, and removes after confirmation', async () => {
    const stored = [member('u1', 'Owner'), member('u2', 'Editor')]
    server.use(
      http.get(MEMBERS_URL, () => HttpResponse.json(stored)),
      http.delete(API_URLS.members.detail(BOARD, 'u2'), () => {
        stored.splice(1, 1)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const wrapper = mountList()
    await settle()

    await wrapper.find('[data-testid="remove-member-u2"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Remove Grace Hopper from this board?')

    await click('[data-testid="cancel-remove-member"]')
    expect(requestLog.some((entry) => entry.method === 'DELETE')).toBe(false)
    expect(wrapper.find('[data-testid="member-u2"]').exists()).toBe(true)

    await wrapper.find('[data-testid="remove-member-u2"]').trigger('click')
    await flushPromises()
    await click('[data-testid="confirm-remove-member"]')

    expect(requestLog.filter((entry) => entry.method === 'DELETE')).toHaveLength(1)
    expect(wrapper.find('[data-testid="member-u2"]').exists()).toBe(false)
    expect(queryClient.getQueryData<BoardMemberDto[]>(membersKeys.list(BOARD))).toEqual([
      member('u1', 'Owner'),
    ])
  })

  it('catches a failed remove mutation without an unhandled rejection or duplicate toast', async () => {
    server.use(
      http.get(MEMBERS_URL, () => HttpResponse.json([member('u1', 'Owner'), member('u2', 'Viewer')])),
      http.delete(API_URLS.members.detail(BOARD, 'u2'), () =>
        HttpResponse.json({ status: 403 }, { status: 403 }),
      ),
    )
    const unhandled: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason)
    }
    window.addEventListener('unhandledrejection', onUnhandled)
    const wrapper = mountList()
    await settle()
    await wrapper.find('[data-testid="remove-member-u2"]').trigger('click')
    await flushPromises()
    await click('[data-testid="confirm-remove-member"]')

    expect(unhandled).toEqual([])
    expect(useToast().toasts.value).toHaveLength(1)
    expect(useToast().toasts.value[0]?.message).toBe("You don't have permission for this action")
    expect(wrapper.find('[data-testid="member-u2"]').exists()).toBe(true)
    window.removeEventListener('unhandledrejection', onUnhandled)
  })

  it('keeps the component reactive when boardId changes', async () => {
    const second = member('u3', 'Owner', { displayName: 'Katherine Johnson' })
    server.use(
      http.get('/api/boards/:boardId/members', ({ params }) =>
        HttpResponse.json(params.boardId === BOARD ? [member('u1', 'Owner')] : [second]),
      ),
    )
    const wrapper: VueWrapper = mount(MemberList, {
      props: { boardId: BOARD },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    })
    await settle()
    await wrapper.setProps({ boardId: 'b2' })
    await settle()

    expect(wrapper.text()).toContain('Katherine Johnson')
  })
})
