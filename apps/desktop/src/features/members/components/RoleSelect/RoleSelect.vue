<template>
  <select
    :value="role"
    :disabled="disabled"
    aria-label="Member role"
    class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    @change="updateRole"
  >
    <option value="Editor">Editor</option>
    <option value="Viewer">Viewer</option>
  </select>
</template>

<script setup lang="ts">
import type { AssignableRole } from '@/shared/types/api'

const props = defineProps<{ role: AssignableRole; disabled?: boolean }>()
const emit = defineEmits<{ (event: 'update:role', value: AssignableRole): void }>()

function updateRole(event: Event): void {
  if (props.disabled) return
  const value = (event.target as HTMLSelectElement).value
  if (value === 'Editor' || value === 'Viewer') emit('update:role', value)
}
</script>
