<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ page: number; pageSize: number; total: number }>();
defineEmits<{ change: [page: number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>
<template>
  <nav class="pagination" aria-label="目录分页">
    <span>共 {{ total }} 条 · 第 {{ page }} / {{ pages }} 页</span>
    <div>
      <button
        type="button"
        class="secondary"
        :disabled="page <= 1"
        @click="$emit('change', page - 1)"
      >
        上一页
      </button>
      <button
        type="button"
        class="secondary"
        :disabled="page >= pages"
        @click="$emit('change', page + 1)"
      >
        下一页
      </button>
    </div>
  </nav>
</template>
