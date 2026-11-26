<script setup lang="ts">
import { useRoute, RouterLink } from 'vue-router';
import {
  auctionSessionDetailResponseSchema,
  auctionCategoryLabels,
  auctionStatusLabels,
} from '@gard/contracts';
import { formatDate, safeSourceUrl, useCatalogue } from '../composables/useCatalogue.js';
import CatalogueState from '../components/CatalogueState.vue';
const route = useRoute();
const { data, loading, error, reload } = useCatalogue(
  () => `/api/auction-sessions/${encodeURIComponent(String(route.params.id))}`,
  auctionSessionDetailResponseSchema,
);
</script>
<template>
  <main>
    <nav class="breadcrumb" aria-label="面包屑">
      <RouterLink to="/sessions">拍场目录</RouterLink><span aria-hidden="true">/</span
      ><span>拍场详情</span>
    </nav>
    <CatalogueState :loading="loading" :error="error" @retry="reload" />
    <template v-if="data">
      <header class="page-heading">
        <p class="eyebrow">
          {{ auctionCategoryLabels[data.data.category] }} ·
          {{ auctionStatusLabels[data.data.status] }}
        </p>
        <h1>{{ data.data.title }}</h1>
        <p class="intro">{{ data.data.description }}</p>
      </header>
      <section class="detail-panel" aria-label="拍场信息">
        <dl class="detail-facts">
          <dt>所属拍卖会</dt>
          <dd>
            <RouterLink :to="`/events/${data.event.id}`">{{ data.event.title }} →</RouterLink>
          </dd>
          <dt>拍卖时间</dt>
          <dd>{{ formatDate(data.data.startsAt) }} — {{ formatDate(data.data.endsAt) }}</dd>
          <dt>地点</dt>
          <dd>
            {{ data.data.city }} · {{ data.data.venue }} · {{ data.data.hall }}<br />{{
              data.event.address
            }}
          </dd>
          <dt>演示拍品数量</dt>
          <dd>{{ data.data.lotCount }} 件</dd>
        </dl>
      </section>
      <aside class="source-note">
        <strong>演示数据说明</strong>
        <p>{{ data.data.sourceNote }}</p>
        <p>本页不提供竞价、报名或交易服务。实际场次安排请以中国嘉德官方公告为准。</p>
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
