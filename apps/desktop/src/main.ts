import './index.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'

import App from '@/app/App/App.vue'
import router from '@/app/router'
import { queryClient } from '@/app/queryClient'
import { reportGlobalError } from '@/shared/composables/useGlobalError'

const app = createApp(App)

// Global error boundary (PLAN.FE.md §13 layer 4): anything not captured by
// onErrorCaptured in App.vue (errors in App's own setup/render, async
// callbacks outside a component scope) lands in the same module-scoped
// store the ErrorFallback renders from. Set BEFORE mount.
app.config.errorHandler = (err, _instance, info) => {
  reportGlobalError(err, info)
}

app.use(createPinia())
app.use(router)
// v5 API note: the plugin option key is `queryClient` (see VueQueryPluginOptions).
app.use(VueQueryPlugin, { queryClient })

app.mount('#app')
