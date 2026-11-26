<script setup lang="ts">
import { reactive, ref } from 'vue';
import { auctionEventsResponseSchema, auctionStatusLabels } from '@gard/contracts';
import { queryUrl, useCatalogue } from '../composables/useCatalogue.js';
import EventCard from '../components/EventCard.vue';
import CatalogueState from '../components/CatalogueState.vue';
import CataloguePagination from '../components/CataloguePagination.vue';
const initial = () => ({ q: '', city: '', status: '' });
const draft = reactive(initial());
const filters = ref(initial());
const page = ref(1);
const { data, loading, error, reload } = useCatalogue(
  () => queryUrl('/api/auction-events', { ...filters.value, page: page.value, pageSize: 6 }),
  auctionEventsResponseSchema,
);
function search() {
  page.value = 1;
  filters.value = { ...draft };
}
function reset() {
  Object.assign(draft, initial());
  search();
}
</script>
<template>
  <main>
    <header class="page-heading">
      <p class="eyebrow">AUCTION CALENDAR / 拍卖日程</p>
      <h1>在一场拍卖中，<br />发现值得关注的收藏。</h1>
      <p class="intro">浏览拍卖会，再进入书画、瓷器、珠宝等不同拍场。所有时间均为北京时间。</p>
    </header>
    <form class="filters" aria-label="筛选拍卖会" @submit.prevent="search">
      <label class="search-field"
        >关键词<input v-model="draft.q" maxlength="100" placeholder="搜索拍卖会名称" type="search"
      /></label>
      <label>城市<input v-model="draft.city" maxlength="40" placeholder="例如：北京" /></label>
      <label
        >状态<select v-model="draft.status">
          <option value="">全部状态</option>
          <option v-for="(label, value) in auctionStatusLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
      <div class="filter-actions">
        <button type="submit">查询</button
        ><button class="secondary" type="button" @click="reset">重置</button>
      </div>
    </form>
    <CatalogueState
      :loading="loading"
      :error="error"
      :empty="data?.data.length === 0"
      @retry="reload"
    />
    <div v-if="data" class="card-grid">
      <EventCard v-for="event in data.data" :key="event.id" :event="event" />
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
