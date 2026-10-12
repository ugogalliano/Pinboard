<template>
  <!-- Layout = page + brand + card chrome only; the routed form renders
       the card content (Phase 3 spec F, extracted from design_pinboard.pen
       frames "01 Login"/"02 Register"). -->
  <main class="min-h-screen w-full bg-background flex flex-col items-center justify-center gap-7">
    <div class="flex flex-col items-center gap-[14px]">
      <div class="w-[52px] h-[52px] rounded-[14px] bg-secondary flex items-center justify-center">
        <span class="text-[26px] font-bold text-secondary-foreground">P</span>
      </div>
      <h1 class="text-[30px] font-bold text-foreground">PostIt</h1>
      <p class="text-sm text-muted-foreground">The collaborative board for your team.</p>
    </div>

    <section
      class="w-full max-w-[420px] bg-card border border-border rounded-2xl shadow-[0_8px_24px_rgba(19,19,17,0.08)] p-8 flex flex-col gap-5"
    >
      <RouterView />
    </section>
  </main>
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>
