import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RoleSelect from './RoleSelect.vue'
import type { AssignableRole } from '@/shared/types/api'

describe('RoleSelect', () => {
  it('renders only assignable roles and emits the changed role', async () => {
    const wrapper = mount(RoleSelect, { props: { role: 'Viewer' } })
    const select = wrapper.find('select')

    expect(select.findAll('option').map((option) => option.element.value)).toEqual([
      'Editor',
      'Viewer',
    ])
    await select.setValue('Editor')
    expect(wrapper.emitted('update:role')).toEqual([['Editor']])
  })

  it('does not emit when the update is pending', async () => {
    const onChange = vi.fn<(value: AssignableRole) => void>()
    const wrapper = mount(RoleSelect, {
      props: { role: 'Editor', disabled: true, 'onUpdate:role': onChange },
    })
    await wrapper.find('select').setValue('Viewer')
    await flushPromises()

    expect(onChange).not.toHaveBeenCalled()
  })
})
