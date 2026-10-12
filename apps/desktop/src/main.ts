import './index.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'

import App from '@/app/App/App.vue'
import router from '@/app/router'
import { queryClient } from '@/app/queryClient'

const app = createApp(App)

app.use(createPinia())
app.use(router)
// v5 API note: the plugin option key is `queryClient` (see VueQueryPluginOptions).
app.use(VueQueryPlugin, { queryClient })

app.mount('#app')
