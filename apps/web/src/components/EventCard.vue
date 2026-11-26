<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { auctionStatusLabels, type AuctionEvent } from '@gard/contracts';
import { formatDate } from '../composables/useCatalogue.js';
defineProps<{ event: AuctionEvent }>();
</script>
<template>
  <article class="catalogue-card event-card">
    <div class="card-top">
      <span class="eyebrow">{{ event.city }} · 拍卖会</span
      ><span class="badge" :class="event.status">{{ auctionStatusLabels[event.status] }}</span>
    </div>
    <h2>
      <RouterLink :to="`/events/${event.id}`">{{ event.title }}</RouterLink>
    </h2>
    <p class="card-description">{{ event.description }}</p>
    <dl class="card-facts">
      <dt>拍卖时间</dt>
      <dd>{{ formatDate(event.startsAt) }} — {{ formatDate(event.endsAt) }}</dd>
      <dt>地点</dt>
      <dd>{{ event.venue }}</dd>
    </dl>
    <div class="card-bottom">
      <span>{{ event.sessionCount }} 个拍场</span
      ><RouterLink :to="`/events/${event.id}`"
        >查看拍卖会 <span aria-hidden="true">→</span></RouterLink
      >
    </div>
  </article>
</template>
