<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { auctionCategoryLabels, auctionStatusLabels, type AuctionSession } from '@gard/contracts';
import { formatDate } from '../composables/useCatalogue.js';
defineProps<{ session: AuctionSession; reasons?: string[] }>();
</script>
<template>
  <article class="catalogue-card session-card">
    <div class="card-top">
      <span class="eyebrow">{{ auctionCategoryLabels[session.category] }}</span><span
        class="badge"
        :class="session.status"
        >{{ auctionStatusLabels[session.status] }}</span
      >
    </div>
    <h2>
      <RouterLink :to="`/sessions/${session.id}`">{{ session.title }}</RouterLink>
    </h2>
    <p class="parent-event">
      <RouterLink :to="`/events/${session.eventId}`">{{ session.eventTitle }}</RouterLink>
    </p>
    <dl class="card-facts">
      <dt>开始时间</dt>
      <dd>{{ formatDate(session.startsAt) }}</dd>
      <dt>地点</dt>
      <dd>{{ session.city }} · {{ session.venue }} · {{ session.hall }}</dd>
    </dl>
    <ul v-if="reasons?.length" class="reasons">
      <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
    </ul>
    <div class="card-bottom">
      <span>{{ session.lotCount }} 件演示拍品</span
      ><RouterLink :to="`/sessions/${session.id}`"
        >查看拍场 <span aria-hidden="true">→</span></RouterLink
      >
    </div>
  </article>
</template>
