<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { liveHealthSchema } from '@gard/contracts';

const state = ref<'loading' | 'ready' | 'error'>('loading');
let request: AbortController | undefined;

async function checkConnection() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  state.value = 'loading';
  try {
    const response = await fetch('/health/live', { signal: controller.signal });
    if (!response.ok) throw new Error('Health request failed');
    liveHealthSchema.parse(await response.json());
    if (!controller.signal.aborted) state.value = 'ready';
  } catch {
    if (!controller.signal.aborted) state.value = 'error';
  }
}

onMounted(checkConnection);
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <main>
    <p class="eyebrow">本地开发环境</p>
    <h1>嘉德智能客服</h1>
    <p class="intro">项目基础环境已准备，客服功能将在后续阶段接入。</p>
    <section aria-label="服务状态">
      <p role="status">
        {{
          state === 'ready'
            ? '前后端连接正常'
            : state === 'error'
              ? '暂时无法连接后端'
              : '正在检查连接…'
        }}
      </p>
      <button type="button" :disabled="state === 'loading'" @click="checkConnection">
        重新检查
      </button>
    </section>
  </main>
</template>
