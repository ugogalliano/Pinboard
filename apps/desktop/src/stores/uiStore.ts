import { defineStore } from 'pinia'
import { ref } from 'vue'

// Transient UI state only — no server data, no persistence.
// Toasts are owned by the design system (`useToast()` + `<Toaster />`),
// NOT by this store (Phase 3 decision A).
export const useUIStore = defineStore('ui', () => {
  const sidebarOpen = ref(true)
  const activeModal = ref<string | null>(null)

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
  }

  function openModal(modal: string): void {
    activeModal.value = modal
  }

  function closeModal(): void {
    activeModal.value = null
  }

  return { sidebarOpen, activeModal, toggleSidebar, openModal, closeModal }
})
