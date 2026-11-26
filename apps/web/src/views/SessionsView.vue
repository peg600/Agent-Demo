<script setup lang="ts">
import { reactive, ref } from 'vue';
import {
  auctionSessionsResponseSchema,
  auctionCategoryLabels,
  auctionStatusLabels,
} from '@gard/contracts';
import { queryUrl, useCatalogue } from '../composables/useCatalogue.js';
import SessionCard from '../components/SessionCard.vue';
import CatalogueState from '../components/CatalogueState.vue';
import CataloguePagination from '../components/CataloguePagination.vue';
const initial = () => ({
  q: '',
  city: '',
  category: '',
  status: '',
  dateFrom: '',
  dateTo: '',
  sort: 'startAsc',
});
const draft = reactive(initial());
const filters = ref(initial());
const page = ref(1);
const validation = ref('');
const { data, loading, error, reload } = useCatalogue(
  () => queryUrl('/api/auction-sessions', { ...filters.value, page: page.value, pageSize: 9 }),
  auctionSessionsResponseSchema,
);
function search() {
  validation.value =
    draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo
      ? '开拍日期止不能早于开拍日期起。'
      : '';
  if (!validation.value) {
    page.value = 1;
    filters.value = { ...draft };
  }
}
function reset() {
  Object.assign(draft, initial());
  search();
}
</script>
<template>
  <main>
    <header class="page-heading">
      <p class="eyebrow">SPECIALIST SESSIONS / 分类拍场</p>
      <h1>找到感兴趣的拍场</h1>
      <p class="intro">按类别、城市和开拍日期浏览。日期范围按北京时间的完整自然日计算。</p>
    </header>
    <form class="filters expanded" aria-label="筛选拍场" @submit.prevent="search">
      <label class="search-field"
        >关键词<input v-model="draft.q" maxlength="100" placeholder="搜索拍场名称" type="search"
      /></label>
      <label>城市<input v-model="draft.city" maxlength="40" placeholder="例如：北京" /></label>
      <label
        >类别<select v-model="draft.category">
          <option value="">全部类别</option>
          <option v-for="(label, value) in auctionCategoryLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
      <label
        >状态<select v-model="draft.status">
          <option value="">全部状态</option>
          <option v-for="(label, value) in auctionStatusLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
      <label>开拍日期起<input v-model="draft.dateFrom" type="date" /></label>
      <label
        >开拍日期止<input v-model="draft.dateTo" type="date" :min="draft.dateFrom || undefined"
      /></label>
      <label
        >排序<select v-model="draft.sort">
          <option value="startAsc">开拍时间从早到晚</option>
          <option value="startDesc">开拍时间从晚到早</option>
        </select></label
      >
      <div class="filter-actions">
        <button type="submit">查询</button
        ><button class="secondary" type="button" @click="reset">重置</button>
      </div>
      <p v-if="validation" class="validation" role="alert">{{ validation }}</p>
    </form>
    <CatalogueState
      :loading="loading"
      :error="error"
      :empty="data?.data.length === 0"
      @retry="reload"
    />
    <div v-if="data" class="card-grid">
      <SessionCard v-for="session in data.data" :key="session.id" :session="session" />
    </div>
    <CataloguePagination
      v-if="data"
      :page="data.page"
      :page-size="data.pageSize"
      :total="data.total"
      @change="page = $event"
    />
  </main>
</template>
