<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router';
import { auctionEventDetailResponseSchema, auctionStatusLabels } from '@gard/contracts';
import { formatDate, safeSourceUrl, useCatalogue } from '../composables/useCatalogue.js';
import SessionCard from '../components/SessionCard.vue';
import CatalogueState from '../components/CatalogueState.vue';
const route = useRoute();
const { data, loading, error, reload } = useCatalogue(
  () => `/api/auction-events/${encodeURIComponent(String(route.params.id))}`,
  auctionEventDetailResponseSchema,
);
</script>
<template>
  <main>
    <nav class="breadcrumb" aria-label="面包屑">
      <RouterLink to="/">拍卖会</RouterLink><span aria-hidden="true">/</span><span>拍卖会详情</span>
    </nav>
    <CatalogueState :loading="loading" :error="error" @retry="reload" />
    <template v-if="data">
      <header class="page-heading">
        <p class="eyebrow">{{ data.data.city }} · {{ auctionStatusLabels[data.data.status] }}</p>
        <h1>{{ data.data.title }}</h1>
        <p class="intro">{{ data.data.description }}</p>
      </header>
      <section class="detail-panel" aria-label="拍卖会信息">
        <dl class="detail-facts">
          <dt>拍卖时间</dt>
          <dd>{{ formatDate(data.data.startsAt) }} — {{ formatDate(data.data.endsAt) }}</dd>
          <dt>预展时间</dt>
          <dd>
            {{ formatDate(data.data.previewStartsAt) }} — {{ formatDate(data.data.previewEndsAt) }}
          </dd>
          <dt>地点</dt>
          <dd>{{ data.data.venue }}<br />{{ data.data.address }}</dd>
        </dl>
      </section>
      <div class="section-heading">
        <h2>本场拍卖会的拍场</h2>
        <span>{{ data.data.sessionCount }} 个拍场</span>
      </div>
      <CatalogueState :loading="false" error="" :empty="data.sessions.length === 0" />
      <div class="card-grid">
        <SessionCard v-for="session in data.sessions" :key="session.id" :session="session" />
      </div>
      <aside class="source-note">
        <strong>演示数据说明</strong>
        <p>{{ data.data.sourceNote }}</p>
        <a
          v-if="safeSourceUrl(data.data.sourceUrl)"
          :href="safeSourceUrl(data.data.sourceUrl)!"
          target="_blank"
          rel="noopener noreferrer"
          >官网日程参考 ↗</a
        >
      </aside>
    </template>
  </main>
</template>
