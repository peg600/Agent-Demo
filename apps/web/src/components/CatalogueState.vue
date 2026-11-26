<script setup lang="ts">
defineProps<{ loading: boolean; error: string; empty?: boolean }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="loading" class="state-panel" role="status">正在读取拍卖目录…</div>
  <div v-else-if="error" class="state-panel" role="alert">
    <p>{{ error }}</p>
    <button type="button" @click="$emit('retry')">重新加载</button>
  </div>
  <div v-else-if="empty" class="state-panel" role="status">
    暂无符合条件的演示数据。可以调整或清空筛选条件。
  </div>
</template>
