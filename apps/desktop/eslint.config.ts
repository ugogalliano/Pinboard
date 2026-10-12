import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'src-tauri/target/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*', 'src/**/*.test.ts', 'test/**/*'],
  },

  {
    // PLAN.FE.md §12/§14 pin the shared component file names
    // (Spinner.vue, Sidebar.vue, Header.vue), which are single words; the
    // vue3-essential multi-word rule is relaxed for exactly those three
    // FILES — scoped by path so no other component may claim the names.
    files: [
      'src/shared/components/layout/Header/Header.vue',
      'src/shared/components/layout/Sidebar/Sidebar.vue',
      'src/shared/components/ui/Spinner/Spinner.vue',
    ],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
