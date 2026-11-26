<script setup lang="ts">
import { reactive, ref } from 'vue';
import { auctionRecommendationsResponseSchema, auctionCategoryLabels } from '@gard/contracts';
import { queryUrl, useCatalogue } from '../composables/useCatalogue.js';
import SessionCard from '../components/SessionCard.vue';
import CatalogueState from '../components/CatalogueState.vue';
const draft = reactive({ city: '', category: '' });
const filters = ref({ ...draft });
const { data, loading, error, reload } = useCatalogue(
  () => queryUrl('/api/auction-recommendations', { ...filters.value, limit: 6 }),
  auctionRecommendationsResponseSchema,
);
function search() {
  filters.value = { ...draft };
}
function reset() {
  draft.city = '';
  draft.category = '';
  search();
}
</script>
<template>
  <main>
    <header class="page-heading">
      <p class="eyebrow">SELECTED SESSIONS / 拍场推荐</p>
      <h1>从兴趣出发，寻找下一场</h1>
      <p class="intro">按城市和类别匹配进行中或即将开始的演示拍场，推荐理由见拍场卡片。</p>
    </header>
    <form class="filters" aria-label="拍场推荐偏好" @submit.prevent="search">
      <label>城市<input v-model="draft.city" maxlength="40" placeholder="例如：北京" /></label>
      <label
        >类别<select v-model="draft.category">
          <option value="">全部类别</option>
          <option v-for="(label, value) in auctionCategoryLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
      <div class="filter-actions">
        <button type="submit">查看推荐</button
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
      <SessionCard
        v-for="item in data.data"
        :key="item.session.id"
        :session="item.session"
        :reasons="item.reasons"
      />
    </div>
  </main>
</template>
